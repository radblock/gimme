var scrypt = require('scrypt')

// Asynchronous with promise
scrypt.kdf('ascii encoded key', {N: 1, r: 1, p: 1}).then(function (result) {
  console.log('Asynchronous result: ' + result.toString('base64'))
}, function (err) {
  if (err) { console.log(err) }
})

function crypto () {
  const hash = function (password) {
    return new Promise(function (resolve, reject) {
      scrypt.kdf(password, {N: 1, r: 1, p: 1})
        .then(function (kdf) {
          resolve(kdf.toString('base64'))
        })
        .catch(reject)
    })
  }

  const check = function (password, kdf) {
    return new Promise(function (resolve, reject) {
      scrypt.verifyKdf(kdf, password)
        .then(resolve)
        .catch(reject)
    })
  }

  return Object.freeze({
    hash,
    check
  })
}

module.exports = crypto()

