'use strict'


/* * * * * * * * * * * * * * * * * * * * * * * * * * * * * * 
 * SETUP
 * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
 */

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


/* * * * * * * * * * * * * * * * * * * * * * * * * * * * * * 
 * API
 * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
 */

/*  request = {
 *    email,
 *    password,
 *    url,
 *    gif
 *  }
 */
api.post('/submit', function (request) {
  return new Promise(function (resolve, reject) {
    return authenticator.go_create_or_find(request.body)
           .then(randomize_filename)
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


/* * * * * * * * * * * * * * * * * * * * * * * * * * * * * * 
 * FUNCTIONS
 * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
 */

/*  user = {
 *    gif,
 *    url,
 *    state,
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
 *    gif_key
 *  }
 */
function go_unpend (user) {
  return new Promise(function (resolve, reject) {
    // TODO: write this
    // move the user's pending gif into the regular bucket and update their state accordingly
    return resolve(user)
  })
}

/*  user = {
 *    status
 *  }
 *  return = {
 *    status: 'rate-limited'
 *  }
 */
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

/*  return = {
 *    signed_request,
 *    bucket,
 *    key
 *  }
 */
}
function go_get_signed_url_for (bucket, user) {
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

/*  request = {
 *    email,
 *    password
 *  }
 *  return = user
 }
 */
function go_create_or_find_user (request) {
  return new Promise(function (resolve, reject) {
    // try to get the user from s3
      // if they do exist, check their password
        // resolve if their password is right
        // reject if their password is wrong
      // else they don't exist, create a new user in s3 and resolve
  })
}

/*  request = {
 *    email,
 *    code
 *  }
 *  return = user
 }
 */
function go_verify_user (request) {
  return new Promise(function (resolve, reject) {
    // try to get the pending user from s3
      // check the code if they do exist
        // resolve if it's correct
  })
}

function gen_random_string (length) {
  var s = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  return Array.apply(null, Array(length))
    .map(function () {
      return s.charAt(Math.floor(Math.random() * s.length))
    }).join('')
}

/*  user = {
 *    filename
 *  }
 *  return = {
 *    gif_key,
 *    filename
 *  }
 */
}
function randomize_filename (user) {
  user.gif_key = gen_random_string(4) + '-' + gen_random_string(4) + '/' + user.filename
  return user
}
