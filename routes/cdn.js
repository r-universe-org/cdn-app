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


function send_from_bucket(hash, operation, res){
  return bucket.find({_id: hash}, {limit:1}).next().then(function(pkg){
    if(!pkg){
      return res.status(410).type("text/plain").send(`File ${hash} not available (anymore)`);
    }
    let name = pkg.filename;

    if(operation == 'send'){
      let type = name.endsWith('.zip') ? 'application/zip' : 'application/x-gzip';
      return stream_file(pkg).pipe(
        res.type(type).attachment(name).set({
          'Content-Length': pkg.length,
          'Cache-Control': 'public, max-age=31557600',
          'Last-Modified' : pkg.uploadDate.toUTCString()
        })
      );
    }


    if(operation == 'index'){
      if(!name.endsWith('gz'))
        throw createError(500, `Unable to index ${name} (only tar.gz files are supported)`);
      return tar_index_files(stream_file(pkg)).then(function(index){
        index.files.forEach(function(entry){
          entry.filename = entry.filename.match(/\/.*/)[0]; //strip pkg root dir
        });
        index.gzip = true;
        res.send(index);
      });
    }

    if(operation == 'decompress'){
      if(!name.endsWith('gz'))
        throw createError(`Unable to decompress ${name} (only tar.gz files are suppored)`);
      var tarname = name.replace(/(tar.gz|tgz)/, 'tar');
      return stream_file(pkg).pipe(gunzip()).pipe(
        res.type('application/tar').attachment(tarname).set({
          'Cache-Control': 'public, max-age=31557600',
          'Last-Modified' : pkg.uploadDate.toUTCString()
        })
      );
    }

    throw createError(500, `Unsuppored operation ${operation}`);
  });
}

/* Reduce noise from crawlers in log files */
router.get("/cdn/robots.txt", function(req, res, next) {
  res.type('text/plain').send(`User-agent: *\nDisallow: /\n`);
});

router.get("/cdn/:hash{/:file}", function(req, res, next) {
  let hash = req.params.hash || "";
  let file = req.params.file || "send";
  if(hash.length != 32 && hash.length != 64) //can be md5 or sha256
    return next(createError(400, "Invalid hash length"));
  return send_from_bucket(hash, file, res);
});

/* index all the files, we have nothing to hide */
router.get("/cdn", function(req, res, next) {
  var cursor = bucket.find({}, {sort: {uploadDate: -1}, project: {_id: 1, filename: 1}});
  return cursor.stream({transform: x => `${x._id} ${x.uploadDate.toISOString()} ${x.filename}\n`}).pipe(res.type('text/plain'));
});

export default router;
