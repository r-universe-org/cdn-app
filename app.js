const express = require('express');
const path = require('path');
const logger = require('morgan');
const cors = require('cors');
const createError = require('http-errors');
const cdnRouter = require('./routes/cdn');
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

module.exports = app;
