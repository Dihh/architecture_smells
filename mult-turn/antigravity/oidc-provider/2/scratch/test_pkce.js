const crypto = require('crypto');
const axios = require('axios');
const qs = require('qs');

const BASE_URL = 'http://localhost:4000';

function base64url(buf) {
  return buf.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

const code_verifier = crypto.randomBytes(32).toString('hex');
const code_challenge = base64url(crypto.createHash('sha256').update(code_verifier).digest());

async function testPKCE() {
  try {
    console.log('1. GET /oauth2/authorize (PKCE)...');
    // Just testing that it renders, we'll go straight to POST
    
    console.log('2. POST /oauth2/authorize (PKCE)...');
    const authResponse = await axios.post(`${BASE_URL}/oauth2/authorize`, qs.stringify({
      client_id: 'test-client',
      redirect_uri: 'http://localhost:8080/callback',
      response_type: 'code',
      scope: 'openid',
      state: 'xyz123',
      username: 'testuser',
      password: 'password123',
      code_challenge: code_challenge,
      code_challenge_method: 'S256'
    }), {
      maxRedirects: 0,
      validateStatus: (status) => status === 302,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    const code = new URL(authResponse.headers.location).searchParams.get('code');
    console.log('Auth Code:', code);

    console.log('\n3. Token exchange without verifier (should fail)...');
    try {
      await axios.post(`${BASE_URL}/oauth2/token`, qs.stringify({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: 'http://localhost:8080/callback',
        client_id: 'test-client',
        client_secret: 'test-secret'
      }));
    } catch (err) {
      console.log('Failed as expected:', err.response.data);
    }

    console.log('\n4. Token exchange with wrong verifier (should fail)...');
    try {
      await axios.post(`${BASE_URL}/oauth2/token`, qs.stringify({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: 'http://localhost:8080/callback',
        client_id: 'test-client',
        client_secret: 'test-secret',
        code_verifier: 'wrong'
      }));
    } catch (err) {
      console.log('Failed as expected:', err.response.data);
    }

    console.log('\n5. Token exchange with correct verifier (should succeed)...');
    const tokenResponse = await axios.post(`${BASE_URL}/oauth2/token`, qs.stringify({
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: 'http://localhost:8080/callback',
      client_id: 'test-client',
      client_secret: 'test-secret',
      code_verifier: code_verifier
    }));
    console.log('Success! Token Response:', !!tokenResponse.data.access_token);

  } catch (error) {
    console.error('Test failed:', error.response ? error.response.data : error.message);
  }
}

testPKCE();
