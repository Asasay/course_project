import express, { Response } from "express";
import sequelize from "../sequelize";
import {
  Review,
  User,
  Comment,
  Like,
  Tag,
  Review_Image,
  Product,
} from "../models/allModels";
import { FindOptions, Includeable, InferAttributes } from "sequelize";
import { StatusCodes } from "http-status-codes";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import { Readable } from "stream";
import { adminOrAuthor, authenticated, validIdParam } from "./handlers";

cloudinary.config({
  cloud_name: "dxb2qepsn",
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const upload = multer({});
const reviews = express.Router();

reviews.get("/", async (req, res) => {
  const limit: number = parseInt(req.query.limit as string);
  const top = Object.prototype.hasOwnProperty.call(req.query, "top");
  const category = req.query.cat;

  if (category && typeof category != "string") return;

  const dbQuery: FindOptions<
    InferAttributes<
      Review,
      {
        omit: never;
      }
    >
  > = {
    attributes: {
      exclude: ["updatedAt", "vector"],
      include: [
        [
          sequelize.cast(
            sequelize.fn("COUNT", sequelize.col("Likes.ReviewId")),
            "integer"
          ),
          "likesCount",
        ],
      ],
    },
    include: [
      {
        model: Like,
        attributes: [],
      },
      { model: Product, attributes: ["category", "name"] },
    ],
    group: ["Review.id", "Product.id"],
    order: [["createdAt", "DESC"]],
  };

  if (top)
    Object.assign(dbQuery, {
      order: [["likesCount", "DESC"]],
    });

  if (category) {
    dbQuery.where = {
      "$Product.category$": category,
    };
  }
  if (limit) Object.assign(dbQuery, { limit: limit, subQuery: false });
  res.send(await Review.findAll(dbQuery));
});

reviews.post("/", authenticated(), async (req, res) => {
  const newReview = await Review.create({
    title: req.body.title,
    text: req.body.text,
    rating: req.body.rating,
    ProductId: req.body.ProductId,
    UserId: req.user?.id,
  });

  await Promise.all(
    req.body.gallery.map(async (image: { id?: number; src: string }) => {
      console.log(image.src);
      const [newImage] = await Review_Image.findOrCreate({
        where: {
          ReviewId: newReview.id,
          src: image.src,
        },
      });
      return newImage;
    })
  );

  const newTags = await Promise.all(
    req.body.tags.map(async (tag: string) => {
      const [newTag] = await Tag.findOrCreate({ where: { name: tag } });
      return newTag;
    })
  );

  await newReview.setTags(newTags);

  res.status(200).send(newReview.id.toString());
});

reviews.post(
  "/gallery",
  authenticated(),
  upload.array("gallery"),
  async (req, res) => {
    const files = req.files as Express.Multer.File[];
    if (!files) {
      return res.status(StatusCodes.BAD_REQUEST).send("No file was uploaded.");
    }

    files.map((file) => {
      if (!file) {
        return res
          .status(StatusCodes.BAD_REQUEST)
          .send("No file was uploaded.");
      }
      const maxSizeMB = 3;
      if (file.size > 1024 * 1024 * maxSizeMB) {
        return res
          .status(StatusCodes.BAD_REQUEST)
          .send(`Size exceeded ${maxSizeMB} MB`);
      }

      if (file.mimetype !== "image/jpeg" && file.mimetype !== "image/png") {
        return res
          .status(StatusCodes.BAD_REQUEST)
          .send("File format is incorrect.");
      }
    });

    const cloudUrls: { src: string | undefined }[] = [];
    files.map((file) => {
      const stream = new Readable({
        read() {
          this.push(file.buffer);
          this.push(null);
        },
      });

      const cldUploadStream = cloudinary.uploader.upload_stream(
        {
          folder: "review_images",
          transformation: {
            format: "jpg",
          },
        },
        function (error, result) {
          cloudUrls.push({ src: result?.secure_url });
          if (cloudUrls.length == files.length) res.json({ urls: cloudUrls });
        }
      );
      stream.pipe(cldUploadStream);
    });
  }
);

reviews.all("/:id", validIdParam());
reviews.get("/:id", async (req, res) => {
  const dbQuery: FindOptions<InferAttributes<Review>> & {
    include: Includeable[];
  } = {
    attributes: { exclude: ["updatedAt", "vector"] },
    include: [Like, Tag],
  };
  if (Object.prototype.hasOwnProperty.call(req.query, "comments")) {
    dbQuery.include.push({
      model: Comment,
      include: [{ model: User, attributes: ["username", "avatar"] }],
    });
    dbQuery.order = [sequelize.col("Comments.createdAt")];
  }
  if (Object.prototype.hasOwnProperty.call(req.query, "user")) {
    dbQuery.include.push({
      model: User,
      attributes: ["username", "avatar"],
    });
  }
  if (Object.prototype.hasOwnProperty.call(req.query, "gallery")) {
    dbQuery.include.push({
      model: Review_Image,
      attributes: ["id", "src"],
    });
  }
  const result = await Review.findByPk(req.params.id, dbQuery);
  if (!result) res.sendStatus(StatusCodes.NOT_FOUND);
  else res.send(result);
});

reviews.delete("/:id", adminOrAuthor(), async (req, res) => {
  await res.locals.review.destroy();
  res.send("OK");
});

reviews.put("/:id", adminOrAuthor(), async (req, res) => {
  res.locals.review.set({
    title: req.body.title,
    text: req.body.text,
    rating: req.body.rating,
  });

  await Promise.all(
    req.body.gallery.map(async (image: { id?: number; src: string }) => {
      const [newImage] = await Review_Image.findOrCreate({
        where: {
          ReviewId: res.locals.review.id,
          src: image.src,
        },
      });
      return newImage;
    })
  );

  const newTags = await Promise.all(
    req.body.tags.map(async (tag: string) => {
      const [newTag] = await Tag.findOrCreate({ where: { name: tag } });
      return newTag;
    })
  );

  await res.locals.review.setTags(newTags);
  await res.locals.review.save();

  res.send("OK");
});

reviews.get("/:id/like", authenticated(), validIdParam(), async (req, res) => {
  const findLike = await Like.findOrCreate({
    where: { ReviewId: req.params.id, UserId: req.user!.id },
  });
  const [like, created] = findLike;
  if (!created) like.destroy();

  res.send("OK");
});

const subscribers: { [key: string]: Response[] } = {};

reviews.get("/:id/comments", validIdParam(), (req, res) => {
  const reviewId = req.params.id;

  res.set({
    Connection: "keep-alive", // allowing TCP connection to remain open for multiple HTTP requests/responses
    "Content-Type": "text/event-stream", // media type for Server Sent Events (SSE)
    "X-Accel-Buffering": "no",
    "Cache-Control": "no-cache",
  });
  res.flushHeaders();
  if (subscribers[reviewId] === undefined) subscribers[reviewId] = [res];
  else subscribers[reviewId] = [...subscribers[reviewId], res];

  res.on("close", () => {
    subscribers[reviewId] = subscribers[reviewId].filter(
      (response) => response != res
    );

    res.end();
  });
});

reviews.post(
  "/:id/comments",
  authenticated(),
  validIdParam(),
  async (req, res) => {
    const reviewId = parseInt(req.params.id);

    const newComment = await Comment.create({
      UserId: req.user!.id,
      ReviewId: reviewId,
      text: req.body.comment,
    });

    const newCommentWithUser = await Comment.findByPk(newComment.id, {
      include: { model: User, attributes: ["avatar", "id", "username"] },
    });
    subscribers[reviewId] &&
      subscribers[reviewId].map((subscriber) => {
        subscriber.write(`data: ${JSON.stringify(newCommentWithUser)}\n\n`);
        subscriber.flush();
      });
    res.sendStatus(200);
  }
);

export default reviews;
