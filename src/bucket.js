const HOST = process.env.CRANLIKE_MONGODB_SERVER || '127.0.0.1';
const PORT = process.env.CRANLIKE_MONGODB_PORT || 27017;
const USER = process.env.CRANLIKE_MONGODB_USERNAME || 'root';
const PASS = process.env.CRANLIKE_MONGODB_PASSWORD;
const AUTH = PASS ? (USER + ':' + PASS + "@") : "";
const URL = 'mongodb://' + AUTH + HOST + ':' + PORT;

import {MongoClient, GridFSBucket} from 'mongodb';
console.log("CDN: connecting to mongo...");
const client = await MongoClient.connect(URL);
const db = client.db('cranlike');
const bucket = new GridFSBucket(db, {bucketName: 'files'});
console.log("CDN: connected to MongoDB!");

export default bucket;
