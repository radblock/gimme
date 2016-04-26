// gimme/main.js

'use strict'

var aws = require('aws-sdk')
var ApiBuilder = require('claudia-api-builder')
var api = new ApiBuilder()

var deps = require('./deps.json')
// {
//   "bucket": "gifs.radblock.xyz"
// }

module.exports = api

api.post('/sign', function (request) {
  console.log('request body: ', request.body)
  // {name, type}

  var gen_random_string = function rrr (n) {
    var s = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    return Array.apply(null, Array(n))
      .map(function () {
        return s.charAt(Math.floor(Math.random() * s.length))
      }).join('')
  }

  var upload_key = gen_random_string(4) + '-' + request.body.name

  var s3 = new aws.S3()
  var s3_params = {
    Bucket: deps.bucket,
    Key: upload_key,
    Expires: 60,
    ContentType: request.body.type,
    ACL: 'public-read'
  }
  console.log(s3_params)
  s3.getSignedUrl('putObject', s3_params, function (err, data) {
    if (err) {
      return err
    }
    var return_data = {
      signed_request: data
    }
    return return_data
  })
})

