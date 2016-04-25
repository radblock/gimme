// gimme/main.js

var aws = require('aws-sdk')
var deps = require('deps.json')

/*
 * Load the S3 information from the environment variables.
 */
var S3_BUCKET = deps.gif_bucket

exports.handler = function (event, context, callback) {
  'use strict'

  console.log('event: ', event)
  // {name, type}

  var gen_random_string = function rrr (n) {
    var s = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    return Array.apply(null, Array(n))
      .map(function () {
        return s.charAt(Math.floor(Math.random() * s.length))
      }).join('')
  }

  var upload_key = gen_random_string(4) + '-' + event.name

  var s3 = new aws.S3()
  var s3_params = {
    Bucket: S3_BUCKET,
    Key: upload_key,
    Expires: 60,
    ContentType: event.type,
    ACL: 'public-read'
  }
  console.log(s3_params)
  s3.getSignedUrl('putObject', s3_params, function (err, data) {
    if (err) {
      callback(err)
    } else {
      var return_data = {
        signed_request: data
      }
      callback(null, return_data)
    }
  })
}

