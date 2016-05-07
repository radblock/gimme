'use strict'

/* * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
 * SETUP
 * * * * * * * * * * * * * * * * * * * * * * * * * * * * * */

var aws = require('aws-sdk')
var s3 = new aws.S3()

var js_schema = require('js-schema')

var ApiBuilder = require('claudia-api-builder')
var api = new ApiBuilder()
module.exports = api

// var deps = require('./deps.json')
var deps = {
  'user_bucket': 'radblock-users',
  'bucket': 'gifs.radblock.xyz',
  'pending_bucket': 'radblock-pending-gifs'
}

/* * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
 * API
 * * * * * * * * * * * * * * * * * * * * * * * * * * * * * */

api.post('/submit', function (request) {
  validate({
    email: String,
    password: String,
    url: String,
    gif: String
  }, request)
  return new Promise(function (resolve, reject) {
    return go_create_or_find_user(request.body)
           .then(randomize_filename)
           .then(go_handle_upload)
           .then(go_validate({
             signed_request: String,
             bucket: [deps.bucket, deps.pending_bucket],
             key: String
           }))
           .then(resolve)
           .catch(function () {
             reject({
               'status': 'failure'
             })
           })
  })
})

api.post('/verify', function (request) {
  validate({
    email: String,
    code: String
  }, request)
  return new Promise(function (resolve, reject) {
    return go_verify_user(request.body)
           .then(go_unpend)
           .then(function () {
             resolve({
               'status': 'success'
             })
           })
           .catch(function () {
             reject({
               'status': 'failure'
             })
           })
  })
})

/* * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
 * FUNCTIONS
 * * * * * * * * * * * * * * * * * * * * * * * * * * * * * */

function go_handle_upload (user) {
  validate({
    gif: String,
    url: String,
    state: ['ready', 'pending', 'rate-limited', 'banned']
  })
  return new Promise(function (resolve, reject) {
    switch (user.state) {
      case 'ready':
        go_rate_limit(user)
        go_charge_card(user)
        return go_get_signed_url_for(deps.bucket, user.gif)
               .then(go_validate({
                 signed_request: String,
                 bucket: [deps.bucket, deps.pending_bucket],
                 key: String
               }))
               .then(resolve)
               .catch(reject)

      case 'pending':
        go_rate_limit(user)
        go_charge_card(user)
        return go_get_signed_url_for(deps.pending_bucket, user.gif)
               .then(go_validate({
                 signed_request: String,
                 bucket: [deps.bucket, deps.pending_bucket],
                 key: String
               }))
               .then(resolve)
               .catch(reject)

      case 'rate-limited':
        return reject('you already uploaded a gif today.')

      case 'banned':
        return reject('you are banned.')
    }
  })
}

function go_unpend (user) {
  validate({
    gif_key: String
  }, user)
  return new Promise(function (resolve, reject) {
    // move the user's pending gif into the regular bucket
    s3.copyObject({
      Bucket: deps.bucket,
      Key: user.gif_key,
      CopySource: `${deps.pending_bucket}/${user.gif_key}`
    }, function (err, data) {
      if (err) { return reject(err) }
      return resolve(user)
    })
  })
}

function go_rate_limit (user) {
  return new Promise(function (resolve, reject) {
    user.state = 'rate-limited'
    return resolve(user)
  })
}

function go_charge_card (user) {
  return new Promise(function (resolve, reject) {
    // TODO: write this
    return resolve(user)
  })
}

function go_get_signed_url_for (bucket, user) {
  validate(String, bucket)
  validate({
    gif: String
  }, user)
  return new Promise(function (resolve, reject) {
    s3.getSignedUrl('putObject', {
      Bucket: bucket,
      Key: user.gif,
      ContentType: 'image/gif',
      ACL: 'public-read'
    }, function (err, data) {
      if (err) { return reject(err) }
      return resolve({
        signed_request: data,
        bucket: bucket,
        key: user.gif
      })
    })
  })
}

function go_create_or_find_user (request) {
  validate({
    email: String,
    password: String
  }, request)
  return new Promise(function (resolve, reject) {
    go_get_user(request)
      .catch(go_create_user)
      .then(resolve)
      .catch(reject)
  })
}

function go_verify_user (request) {
  validate({
    email: String,
    code: String
  }, request)
  return new Promise(function (resolve, reject) {
    go_get_user(request.email)
      .then(function (user) {
        if (user.code === request.code) {
          return resolve(user)
        }
        return reject(user)
      })
      .catch(reject)
  })
}

function go_create_user (request) {
  validate({
    email: String,
    password: String
  }, request)
  return new Promise(function (resolve, reject) {
    go_save_user({
      email: request.email,
      password: request.password
    }).then(resolve)
  })
}

function go_get_user (request) {
  validate({
    email: String
  }, request)
  return new Promise(function (resolve, reject) {
    s3.getObject({
      Bucket: deps.user_bucket,
      Key: request.email
    }, function (err, data) {
      if (err) { return reject(err) }
      return resolve(data)
    })
  })
}

function go_save_user (user) {
  validate({
    email: String
  }, user)
  return new Promise(function (resolve, reject) {
    s3.putObject({
      Bucket: deps.user_bucket,
      Key: user.email
    }, function (err, data) {
      if (err) { return reject(err) }
      return resolve(user)
    })
  })
}

function gen_random_string (length) {
  validate(Number, length)
  var s = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  return Array.apply(null, Array(length))
    .map(function () {
      return s.charAt(Math.floor(Math.random() * s.length))
    }).join('')
}

function randomize_filename (user) {
  validate({
    filename: String
  }, user)
  user.gif_key = gen_random_string(4) + '-' + gen_random_string(4) + '/' + user.filename
  return user
}

function validate (schema, input) {
  var Schema = js_schema(schema)
  return Schema(input)
}

function go_validate (schema) {
  return function (input) {
    return new Promise(function (resolve, reject) {
      var is_validated = validate(schema, input)
      if (is_validated) {
        resolve(input)
      } else {
        reject(input)
      }
    })
  }
}

