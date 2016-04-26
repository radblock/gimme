'use strict'

var aws = require('aws-sdk')
var s3 = new aws.S3()

var ApiBuilder = require('claudia-api-builder')
var api = new ApiBuilder()
module.exports = api

// https://github.com/radblock/lambda-s3-authenticator
var authenticator = require('lambda-s3-authenticator')

// var deps = require('./deps.json')
var deps = {
  'bucket': 'gifs.radblock.xyz',
  'pending_bucket': 'radblock-pending-gifs'
}

/*  request = {
 *    email,
 *    password,
 *    gif
 *  }
 */
api.post('/submit', function (request) {
  return new Promise(function (resolve, reject) {
    return authenticator.go_create_or_find(request.body)
           .then(go_handle_upload)
           .then(resolve)
           .catch(reject)
  })
})

/*  request = {
 *    email,
 *    code
 *  }
 */
api.post('/verify', function (request) {
  return new Promise(function (resolve, reject) {
    return authenticator.go_verify(request.body)
           .then(go_unpend)
           .then(resolve)
           .catch(reject)
  })
})

/*  user = {
 *    gif
 *  }
 */
function go_handle_upload (user) {
  return new Promise(function (resolve, reject) {
    switch (user.state) {
      case 'ready':
        go_rate_limit(user)
        go_charge_card(user)
        return go_get_signed_url_for(deps.bucket, user.gif)
               .then(resolve)

      case 'pending':
        go_rate_limit(user)
        go_charge_card(user)
        return go_get_signed_url_for(deps.pending_bucket, user.gif)
               .then(resolve)

      case 'rate-limited':
        return reject('you already uploaded a gif today.')

      case 'banned':
        return reject('you are banned.')
    }
  })
}

/*  user = {
 *    pending_gif
 *  }
 */
function go_unpend (user) {
  return new Promise(function (resolve, reject) {
    // TODO: write this
    return resolve(user)
  })
}

function go_rate_limit (user) {
  return new Promise(function (resolve, reject) {
    // TODO: write this
    return resolve(user)
  })
}

function go_charge_card (user) {
  return new Promise(function (resolve, reject) {
    // TODO: write this
    return resolve(user)
  })
}

function go_get_signed_url_for (bucket, filename) {
  return new Promise(function (resolve, reject) {
    var upload_key = gen_random_string(4) + '-' + gen_random_string(4) + '/' + filename
    s3.getSignedUrl('putObject', {
      Bucket: bucket,
      Key: upload_key,
      ContentType: 'image/gif',
      ACL: 'public-read'
    }, function (err, data) {
      if (err) { return reject(err) }
      return resolve({
        signed_request: data,
        bucket: bucket,
        key: upload_key
      })
    })
  })
}

function gen_random_string (length) {
  var s = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  return Array.apply(null, Array(length))
    .map(function () {
      return s.charAt(Math.floor(Math.random() * s.length))
    }).join('')
}

