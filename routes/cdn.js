const mongodb = require('mongodb');
const express = require('express');
const router = express.Router();
const createError = require('http-errors');
const HOST = process.env.CRANLIKE_MONGODB_SERVER || '127.0.0.1';
const PORT = process.env.CRANLIKE_MONGODB_PORT || 27017;
const USER = process.env.CRANLIKE_MONGODB_USERNAME || 'root';
const PASS = process.env.CRANLIKE_MONGODB_PASSWORD;
const AUTH = PASS ? (USER + ':' + PASS + "@") : "";
const URL = 'mongodb://' + AUTH + HOST + ':' + PORT;
const connection = mongodb.MongoClient.connect(URL);
var send_from_bucket;

//connect to database
console.log("CDN: connecting to mongo...");
connection.then(function(client) {
  console.log("CDN: connected to MongoDB!");
  const db = client.db('cranlike');
  const bucket = new mongodb.GridFSBucket(db, {bucketName: 'files'});
  send_from_bucket = function(hash, file, res){
    return bucket.find({_id: hash}, {limit:1}).next().then(function(x){
      if(!x)
        throw `Failed to locate file in gridFS: ${hash}`;
      if(file !== x.filename)
        throw `Incorrect filename ${file} (should be: ${x.filename})`;
      let type = x.filename.endsWith('.zip') ? 'application/zip' : 'application/x-gzip';
      return bucket.openDownloadStream(x['_id']).pipe(
        res.type(type).set({
          'Content-Length': x.length,
          'Cache-Control': 'public, max-age=31557600',
          'Last-Modified' : x.uploadDate.toUTCString()
        })
      );
    });
  }
});

function error_cb(status, next) {
  return function(err){
    console.log("[CDN-APP] HTTP " + status + ": " + err)
    next(createError(status, err));
  }
}

router.get("/cdn/:hash/:file", function(req, res, next) {
  let hash = req.params.hash || "";
  let file = req.params.file || "";
  if(hash.length != 32) //assume md5 for now
    return next(createError(400, "Invalid hash length"));
  send_from_bucket(hash, file, res).catch(error_cb(400, next));
});

router.get("/", function(req, res, next) {
  next(createError(400, "Invalid CDN req: " + req.url));
});

module.exports = router;
