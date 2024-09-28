import express from 'express';
import logger from 'morgan';
import cors from 'cors';
import createError from 'http-errors';
import cdnRouter from './routes/cdn.js';
const app = express();

app.use(cors())
app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use('/', cdnRouter);

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  next(createError(404));
});

// error handler
app.use(function(err, req, res, next) {
  res.status(err.status || 500);
  res.type("text/plain").send(err.message || "CDN lookup error");
});

export default app;
