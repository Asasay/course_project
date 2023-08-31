import express = require("express");
import cookieSession from "cookie-session";
import cookieParser from "cookie-parser"; // parse cookie header
import passport from "passport";
import "./passport";
import { User, Like, Review } from "./models/allModels";
import logger from "./logger";
import auth from "./routes/auth";
import search from "./routes/search";
import reviews from "./routes/reviews";
import tags from "./routes/tags";
import "dotenv/config";
import { StatusCodes } from "http-status-codes";

const app = express();
app.use(express.json());
app.use(express.static(__dirname + "/../dist/public"));
app.use(cookieParser());
app.use(
  cookieSession({
    name: "session",
    secret: process.env.COOKIE_SECRET,
    maxAge: 24 * 60 * 60 * 1000,
  })
);
app.use(passport.initialize());
app.use(passport.session());

if (app.get("env") === "production") {
  app.set("trust proxy", 1); // trust first proxy
}

// Bug workaround: register regenerate & save after the cookieSession middleware initialization
app.use(function (request, response, next) {
  if (request.session && !request.session.regenerate) {
    request.session.regenerate = (cb: () => void) => {
      cb();
    };
  }
  if (request.session && !request.session.save) {
    request.session.save = (cb: () => void) => {
      cb();
    };
  }
  next();
});

app.use("/auth", auth);
app.use("/api/search", search);
app.use("/api/reviews", reviews);
app.use("/api/tags", tags);
app.get("/api/users/me", (req, res) => {
  User.findByPk(req.user?.id, {
    attributes: { exclude: ["hashedPassword", "salt"] },
    include: { model: Like, attributes: ["ReviewId"] },
  }).then((user) => {
    res.status(200).json({
      authenticated: req.isAuthenticated(),
      user: user?.sanitize(),
    });
  });
});

app.get("/api/users/:id", (req, res) => {
  User.findByPk(req.params.id, {
    attributes: { exclude: ["hashedPassword", "salt"] },
    include: [
      { model: Like, attributes: ["ReviewId"] },
      { model: Review, attributes: ["id"] },
    ],
  }).then((user) => {
    if (!user) return res.sendStatus(StatusCodes.NOT_FOUND);
    res.status(200).json(user?.sanitize());
  });
});

app.get("*", (req, res) => {
  res.sendFile("index.html", { root: __dirname + "/../dist/public/" });
});
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  logger.info(`Express: Server is listening on port ${PORT}`);
});
