import mongodb from 'mongodb';
import express from 'express';
import gunzip from 'gunzip-maybe';
import tar from 'tar-stream';
import createError from 'http-errors';

const router = express.Router();
const HOST = process.env.CRANLIKE_MONGODB_SERVER || '127.0.0.1';
const PORT = process.env.CRANLIKE_MONGODB_PORT || 27017;
const USER = process.env.CRANLIKE_MONGODB_USERNAME || 'root';
const PASS = process.env.CRANLIKE_MONGODB_PASSWORD;
const AUTH = PASS ? (USER + ':' + PASS + "@") : "";
const URL = 'mongodb://' + AUTH + HOST + ':' + PORT;
const connection = mongodb.MongoClient.connect(URL);
let bucket;

function tar_index_files(input){
  let files = [];
  let extract = tar.extract({allowUnknownFormat: true});
  return new Promise(function(resolve, reject) {
    function process_entry(header, stream, next_entry) {
      if(header.size > 0 && header.name.match(/\/.*/)){
        files.push({
          filename: header.name,
          start: extract._buffer.shifted,
          end: extract._buffer.shifted + header.size
        });
      }
      stream.on('end', function () {
        next_entry();
      })
      stream.on('error', reject);
      stream.resume();
    }

    function finish_stream(){
      resolve({files: files, remote_package_size: extract._buffer.shifted});
    }

    var extract = tar.extract({allowUnknownFormat: true})
      .on('entry', process_entry)
      .on('finish', finish_stream)
      .on('error', function(err){
        if (err.message.includes('Unexpected end') && files.length > 0){
          finish_stream(); //workaround tar-stream error for webr 0.4.2 trailing junk
        } else {
          reject(err);
        }
      });


    input.pipe(gunzip()).pipe(extract);
  });
}

function stream_file(x){
  return bucket.openDownloadStream(x['_id']);
}

//connect to database
console.log("CDN: connecting to mongo...");
connection.then(function(client) {
  console.log("CDN: connected to MongoDB!");
  const db = client.db('cranlike');
  bucket = new mongodb.GridFSBucket(db, {bucketName: 'files'});
});

function send_from_bucket(hash, file, res){
  return bucket.find({_id: hash}, {limit:1}).next().then(function(pkg){
    if(!pkg){
      return res.status(410).type("text/plain").send(`File ${hash} not available (anymore)`);
    }
    let name = pkg.filename;
    if(file === `${name}.index` && name.endsWith('gz')){
      return tar_index_files(stream_file(pkg)).then(function(index){
        index.files.forEach(function(entry){
          entry.filename = entry.filename.match(/\/.*/)[0]; //strip pkg root dir
        });
        index.gzip = true;
        res.send(index);
      });
    } else if(name.endsWith('gz') && file === name.replace(/(tar.gz|tgz)/, 'tar')){
      return stream_file(pkg).pipe(gunzip()).pipe(
        res.type('application/tar').set({
          'Cache-Control': 'public, max-age=31557600',
          'Last-Modified' : pkg.uploadDate.toUTCString()
        })
      );
    } else if(file === name){
      let type = name.endsWith('.zip') ? 'application/zip' : 'application/x-gzip';
      return stream_file(pkg).pipe(
        res.type(type).set({
          'Content-Length': pkg.length,
          'Cache-Control': 'public, max-age=31557600',
          'Last-Modified' : pkg.uploadDate.toUTCString()
        })
      );
    } else {
      throw `Incorrect request ${file} (file is: ${name})`;
    }
  });
}

function error_cb(status, next) {
  return function(err){
    console.log("[CDN-APP] HTTP " + status + ": " + err)
    next(createError(status, err));
  }
}

router.get("/cdn/:hash/:file", function(req, res, next) {
  let hash = req.params.hash || "";
  let file = req.params.file || "";
  let ref = req.query.ref ? atob(req.query.ref) : "unknown";
  if(hash.length != 32) //assume md5 for now
    return next(createError(400, "Invalid hash length"));
  send_from_bucket(hash, file, res).catch(error_cb(400, next));
});

router.get("/", function(req, res, next) {
  next(createError(400, "Invalid CDN req: " + req.url));
});

export default router;
