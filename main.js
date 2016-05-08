'use strict'

/* * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
 * SETUP
 * * * * * * * * * * * * * * * * * * * * * * * * * * * * * */

const aws = require('aws-sdk')
const s3 = new aws.S3()
const ses = new aws.SES()

const random_word = require('random-word')

const crypto = require('crypto')

const js_schema = require('js-schema')

const ApiBuilder = require('claudia-api-builder')
const api = new ApiBuilder()
module.exports = api

// const deps = require('./deps.json')
const deps = {
  'user_bucket': 'radblock-users',
  'bucket': 'gifs.radblock.xyz',
  'pending_bucket': 'radblock-pending-gifs',
  'rate_limit_bucket': 'radblock-rate-limit',
  'my_url': 'https://89c4l3k2gj.execute-api.us-east-1.amazonaws.com/latest',
  'website_url': 'http://radblock.xyz'
}

/* * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
 * CRYPTO
 *
 * https://gist.github.com/skeggse/52672ddee97c8efec269
 * * * * * * * * * * * * * * * * * * * * * * * * * * * * * */

const passwords = (function () {
  // larger numbers mean better security, less
  const config = {
    // size of the generated hash
    hashBytes: 32,
    // larger salt means hashed passwords are more resistant to rainbow table, but
    // you get diminishing returns pretty fast
    saltBytes: 16,
    // more iterations means an attacker has to take longer to brute force an
    // individual password, so larger is better. however, larger also means longer
    // to hash the password. tune so that hashing the password takes about a
    // second
    iterations: 10000
  }

  /**
   * Hash a password using Node's asynchronous pbkdf2 (key derivation) function.
   *
   * Returns a self-contained buffer which can be arbitrarily encoded for storage
   * that contains all the data needed to verify a password.
   *
   * @param {!String} password
   * @param {!function(?Error, ?Buffer=)} callback
   */
  const hash = function (user) {
    verify({
      password: String
    }, user)
    return new Promise(function (resolve, reject) {
      console.log('making a hash')
      // generate a salt for pbkdf2
      crypto.randomBytes(config.saltBytes, function (err, salt) {
        console.log('making random bytes')
        if (err) { reject('error making random bytes') }

        console.time('hashing')
        crypto.pbkdf2(user.password, salt, config.iterations, config.hashBytes, function (err, hash) {
          console.timeEnd('hashing')
          if (err) { return reject('error pbkdf2-ing') }

          let combined = new Buffer(hash.length + salt.length + 8)

          // include the size of the salt so that we can, during verification,
          // figure out how much of the hash is salt
          combined.writeUInt32BE(salt.length, 0, true)
          // similarly, include the iteration count
          combined.writeUInt32BE(config.iterations, 4, true)

          salt.copy(combined, 8)
          hash.copy(combined, salt.length + 8)
          const string = combined.toString('base64')
          delete user.password
          user.kdf = string
          resolve(user)
        })
      })
    })
  }

  /**
   * Verify a password using Node's asynchronous pbkdf2 (key derivation) function.
   *
   * Accepts a hash and salt generated by hashPassword, and returns whether the
   * hash matched the password (as a boolean).
   *
   * @param {!String} password
   * @param {!Buffer} combined Buffer containing hash and salt as generated by
   *   hashPassword.
   * @param {!function(?Error, !boolean)}
   */
  const verify = function (password, combined_string) {
    return new Promise(function (resolve, reject) {
      const combined = new Buffer(combined_string, 'base64')
      // extract the salt and hash from the combined buffer
      const saltBytes = combined.readUInt32BE(0)
      const hashBytes = combined.length - saltBytes - 8
      const iterations = combined.readUInt32BE(4)
      const salt = combined.slice(8, saltBytes + 8)
      const hash = combined.toString('binary', saltBytes + 8)

      // verify the salt and hash against the password
      console.time('verifying')
      crypto.pbkdf2(password, salt, iterations, hashBytes, function (err, verify) {
        console.timeEnd('verifying')
        if (err) { return reject('err pbkdf2-ing') }
        if (verify.toString('binary') === hash) {
          return resolve(true)
        } else {
          return reject('passwords don\'t match')
        }
      })
    })
  }

  return Object.freeze({
    verify,
    hash
  })
})()

/* * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
 * API
 * * * * * * * * * * * * * * * * * * * * * * * * * * * * * */

api.post('/submit', function (request) {
  console.log('hit submit endpoint')
  validate({
    email: String,
    password: String,
    filename: String
  }, request.body)
  return new Promise(function (resolve, reject) {
    return go_create_or_find_user(request.body)
           .then(randomize_filename)
           .then(go_save_user)
           .then(go_handle_upload)
           .then(resolve)
           .catch(function (reason) {
             reject(reason)
           })
  })
})

api.get('/verify', function (request) {
  console.log('hit verify endpoint')
  validate({
    email: String,
    code: String
  }, request.queryString)
  return new Promise(function (resolve, reject) {
    return go_verify_user(request.queryString)
           .then(go_unpend)
           .then(go_rate_limit)
           .then(go_save_user)
           .then(function () {
             resolve('Your email is verified!')
           })
           .catch(function (reason) {
             reject(reason)
           })
  })
})

/* * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
 * FUNCTIONS
 * * * * * * * * * * * * * * * * * * * * * * * * * * * * * */

function go_check_password (user) {
  console.log('checking user password')
  validate({
    password: String,
    kdf: String
  }, user)
  return new Promise(function (resolve, reject) {
    passwords.verify(user.password, user.kdf)
    .then(function () {
      delete user.password
      resolve(user)
    })
    .catch(function () {
      reject('bad password')
    })
  })
}

function go_handle_upload (user) {
  console.log('handling upload')
  validate({
    gif_key: String,
    state: ['ready', 'pending', 'rate-limited', 'banned', 'to-pend']
  }, user)
  return new Promise(function (resolve, reject) {
    switch (user.state) {
      case 'ready':
        return go_rate_limit(user)
               .then(go_save_user)
               .then(function () {
                 return go_get_signed_url_for(deps.bucket, user)
               })
               .then(add_message('Your gif is uploading!'))
               .then(resolve)
               .catch(reject)

      case 'to-pend':
        return go_pend(user)
               .then(go_save_user)
               .then(function (u) {
                 return go_get_signed_url_for(deps.pending_bucket, u)
               })
               .then(add_message('Your gif is uploading, but you have to verify your email address before it shows up in ppls browsers.'))
               .then(resolve)
               .catch(reject)

      case 'pending':
        return reject('you need to verify your email address. go check your email.')

      case 'rate-limited':
        return reject('you already uploaded a gif today.')

      case 'banned':
        return reject('you are banned.')
    }
  })
}

function go_pend (user) {
  console.log('pending')
  validate({
    state: 'to-pend'
  }, user)
  return new Promise(function (resolve, reject) {
    user.state = 'pending'
    resolve(user)
  })
}

function go_unpend (user) {
  console.log('unpending')
  validate({
    gif_key: String
  }, user)
  return new Promise(function (resolve, reject) {
    // move the user's pending gif into the regular bucket
    s3.copyObject({
      Bucket: deps.bucket,
      Key: user.gif_key,
      ACL: 'public-read',
      CopySource: `${deps.pending_bucket}/${user.gif_key}`
    }, function (err, data) {
      if (err) { return reject(err) }
      return resolve(user)
    })
  })
}

function go_rate_limit (user) {
  validate({
    state: 'ready'
  }, user)
  console.log('rate limiting')
  return new Promise(function (resolve, reject) {
    s3.putObject({
      Key: user.email,
      Bucket: deps.rate_limit_bucket
    }, function (err, data) {
      if (err) { console.log('error rate limiting', err); return reject(err) }
      user.state = 'rate-limited'
      return resolve(user)
    })
  })
}

function go_charge_card (user) {
  console.log('charging card')
  return new Promise(function (resolve, reject) {
    // TODO: write this
    return resolve(user)
  })
}

function go_get_signed_url_for (bucket, user) {
  console.log('getting signed url')
  validate(String, bucket)
  validate({
    gif_key: String
  }, user)
  return new Promise(function (resolve, reject) {
    s3.getSignedUrl('putObject', {
      Bucket: bucket,
      Key: user.gif_key,
      ContentType: 'image/gif',
      ACL: 'public-read'
    }, function (err, data) {
      if (err) { return reject(err) }
      return resolve({
        signed_request: data,
        bucket: bucket,
        key: user.gif_key
      })
    })
  })
}

function go_create_or_find_user (request) {
  console.log('finding or creating a user')
  validate({
    email: String,
    password: String
  }, request)
  return new Promise(function (resolve, reject) {
    go_get_user(request)
    .catch(function (reason) {
      if (reason === 'bad password') {
        return reject('bad password')
      }
      return go_create_user(request)
             .then(resolve)
    })
    .then(go_check_password)
    .then(resolve)
  })
}

function go_verify_user (request) {
  console.log('verifying a user', request)
  validate({
    email: String,
    code: String
  }, request)
  return new Promise(function (resolve, reject) {
    go_get_user(request)
    .then(go_validate({
      code: String,
      state: String
    }))
    .then(function (user) {
      if (user.state !== 'pending') { return reject('you can\'t be verified because you are ' + user.state) }
      if (user.code === request.code) {
        user.state = 'ready'
        return resolve(user)
      }
      return reject(user)
    })
    .catch(reject)
  })
}

function go_create_user (request) {
  console.log('creating a user')
  validate({
    email: String,
    password: String,
    filename: String
  }, request)
  return new Promise(function (resolve, reject) {
    request.state = 'to-pend'
    passwords.hash(request)
    .then(go_send_code)
    .then(resolve)
  })
}

function go_get_user (request) {
  console.log('getting a user', request)
  validate({
    email: String
  }, request)
  return new Promise(function (resolve, reject) {
    s3.getObject({
      Bucket: deps.user_bucket,
      Key: request.email
    }, function (err, data) {
      if (err) { console.log('user does not exist', err); return reject(request) }
      let user = merge(request, JSON.parse(data.Body))
      validate({
        email: String,
        state: String
      }, user)
      resolve(user)
    })
  })
}

function go_save_user (user) {
  console.log('saving a user')
  validate({
    email: String
  }, user)
  return new Promise(function (resolve, reject) {
    s3.putObject({
      Bucket: deps.user_bucket,
      Key: user.email,
      Body: JSON.stringify(user)
    }, function (err, data) {
      if (err) { return reject(err) }
      return resolve(user)
    })
  })
}

function gen_random_string (length) {
  const s = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  return Array.apply(null, Array(length))
    .map(function () {
      return s.charAt(Math.floor(Math.random() * s.length))
    }).join('')
}

function randomize_filename (user) {
  console.log('randomizing a user\'s filename')
  validate({
    filename: String
  }, user)
  user.gif_key = gen_random_string(4) + '-' + gen_random_string(4) + '/' + user.filename
  delete user.filename
  return new Promise(function (resolve, reject) {
    resolve(user)
  })
}

function validate (schema, input) {
  console.log('validating', input)
  const Schema = js_schema(schema)
  if (Schema(input)) {
    return true
  } else {
    throw new TypeError('failed validation')
  }
}

function go_validate (schema) {
  return function (input) {
    return new Promise(function (resolve, reject) {
      const is_validated = validate(schema, input)
      if (is_validated) {
        resolve(input)
      } else {
        reject(input)
      }
    })
  }
}

function go_send_code (user) {
  console.log('sending a code')
  console.log('user', user)
  validate({
    email: String,
    filename: String
  }, user)
  return new Promise(function (resolve, reject) {
    console.log('in send promise')
    user.code = [1, 2, 3].map(random_word).join('-')
    const url = deps.website_url + '/?email=' + user.email + '&code=' + user.code
    const params = {
      Destination: {
        ToAddresses: [user.email]
      },
      Message: {
        Body: {
          Html: {
            Data: 'visit <a href="' + url + '">this page</a> to finish uploading ' + user.filename,
            Charset: 'UTF-8'
          },
          Text: {
            Data: 'visit ' + url + ' to finish uploading ' + user.filename,
            Charset: 'UTF-8'
          }
        },
        Subject: {
          Data: 'verify your email address for radblock',
          Charset: 'UTF-8'
        }
      },
      Source: 'system@radblock.xyz'
    }
    console.log('about to send email', user)
    ses.sendEmail(params, function (err, data) {
      console.log('tried to send email', err, data)
      if (err) { console.log('failed to send email', err, err.stack); return reject(user) }
      console.log('sent email. code is', user.code)
      resolve(user)
    })
  })
}

function merge (a, b) {
  let c = {}
  for (const attrname in a) { c[attrname] = a[attrname] }
  for (const attrname in b) { c[attrname] = b[attrname] }
  return c
}

function add_message (message) {
  return function (a) {
    return new Promise(function (resolve, reject) {
      a.message = message
      resolve(a)
    })
  }
}

