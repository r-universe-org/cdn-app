import express from 'express';
import gunzip from 'gunzip-maybe';
import tar from 'tar-stream';
import createError from 'http-errors';
import bucket from '../src/bucket.js';

const router = express.Router();


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


function send_from_bucket(hash, file, res){
  return bucket.find({_id: hash}, {limit:1}).next().then(function(pkg){
    if(!pkg){
      return res.status(410).type("text/plain").send(`File ${hash} not available (anymore)`);
    }
    let name = pkg.filename;
    if(file === `${name}.index` && name.endsWith('gz')){
      /* Can be removed when WebR v0.3.3 is EOL */
      return tar_index_files(stream_file(pkg)).then(function(index){
        index.files.forEach(function(entry){
          entry.filename = entry.filename.match(/\/.*/)[0]; //strip pkg root dir
        });
        index.gzip = true;
        res.send(index);
      });
    } else if(name.endsWith('gz') && file === name.replace(/(tar.gz|tgz)/, 'tar')){
      /* Can be removed when WebR v0.3.3 is EOL */
      return stream_file(pkg).pipe(gunzip()).pipe(
        res.type('application/tar').set({
          'Cache-Control': 'public, max-age=31557600',
          'Last-Modified' : pkg.uploadDate.toUTCString()
        })
      );
    } else {
      let type = name.endsWith('.zip') ? 'application/zip' : 'application/x-gzip';
      return stream_file(pkg).pipe(
        res.type(type).attachment(name).set({
          'Content-Length': pkg.length,
          'Cache-Control': 'public, max-age=31557600',
          'Last-Modified' : pkg.uploadDate.toUTCString()
        })
      );
    }
  });
}

function error_cb(status, next) {
  return function(err){
    console.log("[CDN-APP] HTTP " + status + ": " + err)
    next(createError(status, err));
  }
}

router.get("/cdn/:hash/:file?", function(req, res, next) {
  let hash = req.params.hash || "";
  let file = req.params.file || "";
  if(hash.length != 32 && hash.length != 64) //assume md5 for now
    return next(createError(400, "Invalid hash length"));
  send_from_bucket(hash, file, res).catch(error_cb(400, next));
});

router.get("/", function(req, res, next) {
  next(createError(400, "Invalid CDN req: " + req.url));
});

export default router;
