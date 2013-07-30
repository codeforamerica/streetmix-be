var mongoose = require('mongoose'),
    config = require('config'),
    uuid = require('uuid'),
    twitter = require('twitter'),
    db = require('../../../lib/db.js'),
    User = require('../../../models/user.js')

exports.post = function(req, res) {

  var loginToken = null

  var handleTwitterSignIn = function(twitterCredentials) {

    // TODO: Call Twitter API with OAuth access credentials to make sure they are valid

    var handleCreateUser = function(err, user) {
      if (err) {
        req.log.error(err)
        res.send(500, 'Could not create user.')
        return
      }

      var userJson = { id: user.id, loginToken: loginToken }
      req.log.info({ user: userJson }, 'New user created.')
      res.header('Location', config.restapi.baseuri + '/v1/users/' + user.id)
      res.send(201, userJson)

    } // END function - handleCreateUser

    var handleUpdateUser = function(err, user) {
      
      if (err) {
        req.log.error(err)
        res.send(500, 'Could not update user.')
        return
      }

      var userJson = { id: user.id, loginToken: loginToken }
      req.log.info({ user: userJson }, 'Existing user issued new login token.')

      res.header('Location', config.restapi.baseuri + '/v1/users/' + user.id)
      res.send(200, userJson)

    } // END function - handleUpdateUser

    var handleFindUser = function(err, user) {
      
      if (err) {
        req.log.error(err)
        res.send(500, 'Error finding user with Twitter ID.')
        return
      }
      
      loginToken = uuid.v1()
      if (!user) {
        var u = new User({
          id: twitterCredentials.screenName,
          twitter_id: twitterCredentials.userId,
          twitter_credentials: {
            access_token_key: twitterCredentials.oauthAccessTokenKey,
            access_token_secret: twitterCredentials.oauthAccessTokenSecret
          },
          login_tokens: [ loginToken ]
        })
        u.save(handleCreateUser)

      } else {
        user.id = twitterCredentials.screenName,
        user.twitter_credentials = { 
          access_token_key: twitterCredentials.oauthAccessTokenKey,
          access_token_secret: twitterCredentials.oauthAccessTokenSecret
        }
        user.login_tokens.push(loginToken)
        user.save(handleUpdateUser)
      }

    } // END function - handleFindUser
    
    // Try to find user with twitter ID
    User.findOne({ twitter_id: twitterCredentials.userId }, handleFindUser)

  } // END function - handleTwitterSignIn

  var body
  try {
    body = JSON.parse(req.body)
  } catch (e) {
    res.send(400, 'Could not parse body as JSON.')
    return
  }

  if (body.hasOwnProperty('twitter')) {

    // TODO: Validation

    handleTwitterSignIn(body.twitter)
  } else {
    res.send(400, 'Unknown sign-in method used.')
  }

} // END function - exports.post

exports.get = function(req, res) {

  var handleFindUser = function(err, user) {
   
    if (!user) {
      res.send(404, 'User not found.')
      return
    }

    var twitterApiClient
      try {

          twitterApiClient = new twitter({
            consumer_key: config.twitter.oauth_consumer_key,
            consumer_secret: config.twitter.oauth_consumer_secret,
            access_token_key: user.twitter_credentials.access_token_key,
            access_token_secret: user.twitter_credentials.access_token_secret
          })
        
      } catch (e) {
        req.log.error('Could not initialize Twitter API client. Error:')
        req.log.error(e)
      }
    
    var sendUserJson = function(twitterData) {

      var auth = (user.login_tokens.indexOf(req.params.loginToken) > 0)
      user.asJson({ auth: auth }, function(err, userJson) {
        
        if (err) {
          req.log.error(err)
          res.send(500, 'Could not render user JSON.')
          return
        }
        
        if (twitterData) {
          userJson.profileImageUrl = twitterData.profile_image_url
        }

        res.send(200, userJson)
        
      })

    } // END function - sendUserJson

    var handleFetchUserProfileFromTwitter = function(data) {

      req.log.debug({ profile_image_url: data.profile_image_url }, 'Twitter API users/show call returned.')
      if (!data) {
          req.log.error('Twitter API call users/show did not return any data.')
      }

      sendUserJson(data)

    } // END function - handleFetchUserProfileFromTwitter
    
    if (twitterApiClient) {
      req.log.debug('About to call Twitter API: /users/show.json?user_id=' + user.twitter_id)
      twitterApiClient.get('/users/show.json', { user_id: user.twitter_id }, handleFetchUserProfileFromTwitter)
    } else {
      sendUserJson()
    }
    
  } // END function - handleFindUser
  
  // Flag error if user ID is not provided
  if (!req.params.user_id) {
    res.send(400, 'Please provide user ID.')
    return
  }

  var userId = req.params.user_id
  User.findOne({ id: userId }, handleFindUser)

} // END function - exports.get

exports.delete = function(req, res) {

  var handleSaveUser = function(err, user) {

    if (err) {
      req.log.error(err)
      res.send(500, 'Could not sign-out user.')
      return
    }
    res.send(204)

  } // END function - handleSaveUser

  var handleFindUser = function(err, user) {

    if (!user) {
      res.send(404, 'User not found.')
      return
    }
    
    var idx = user.login_tokens.indexOf(req.params.loginToken)
    if (idx === -1) {
      res.send(401)
      return
    }
    
    user.login_tokens.splice(idx, 1)
    user.save(handleSaveUser)
    
  } // END function - handleFindUser
  
  // Flag error if user ID is not provided
  if (!req.params.user_id) {
    res.send(400, 'Please provide user ID.')
    return
  }
  
  var userId = req.params.user_id
  User.findOne({ id: userId }, handleFindUser)
  
} // END function - exports.delete

exports.put = function(req, res) {

  var body
  try {
    body = JSON.parse(req.body)
  } catch (e) {
    res.send(400, 'Could not parse body as JSON.')
    return
  }

  var handleSaveUser = function(err, user) {

    if (err) {
      req.log.error(err)
      res.send(500, 'Could not update user information.')
      return
    }
    res.send(204)

  } // END function - handleSaveUser

  var handleFindUser = function(err, user) {

    if (!user) {
      res.send(404, 'User not found.')
      return
    }

    if (user.login_tokens.indexOf(req.params.loginToken) === -1) {
      res.send(401)
      return
    }

    user.data = body.data || user.data
    user.save(handleSaveUser)

  } // END function - handleFindUser

  // Flag error if user ID is not provided
  if (!req.params.user_id) {
    res.send(400, 'Please provide user ID.')
    return
  }

  var userId = req.params.user_id
  User.findOne({ id: userId }, handleFindUser)

} // END function - exports.put
