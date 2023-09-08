import express from "express";
import { Comment, Like, Review } from "../models/allModels";
import sequelize from "../sequelize";
import { Op } from "sequelize";

const search = express.Router();
search.post("/", async (req, res) => {
  const searchResults = await Review.findAll({
    attributes: { exclude: ["rating", "createdAt", "updatedAt"] },
    include: [Like, Comment],
    where: {
      [Op.or]: [
        {
          vector: {
            [Op.match]: sequelize.fn(
              "plainto_tsquery",
              "english",
              req.body.search
            ),
          },
        },
        {
          "$Comments.vector$": {
            [Op.match]: sequelize.fn(
              "plainto_tsquery",
              "english",
              req.body.search
            ),
          },
        },
      ],
    },
    order: [
      [
        sequelize.fn(
          "ts_rank",
          sequelize.col("Review.vector"),
          sequelize.fn("plainto_tsquery", "english", req.body.search)
        ),
        "DESC",
      ],
      [
        sequelize.fn(
          "ts_rank",
          sequelize.col("Comments.vector"),
          sequelize.fn("plainto_tsquery", "english", req.body.search)
        ),
        "DESC",
      ],
    ],
    limit: req.body.limit,
    subQuery: false,
  });
  type Optional<T, K extends keyof T> = Pick<Partial<T>, K> & Omit<T, K>;
  const formated = searchResults.map((review) => review.toJSON()) as Optional<
    Review,
    "vector"
  >[];
  formated.forEach((review) => delete review.vector);
  res.json(formated);
});

export default search;
