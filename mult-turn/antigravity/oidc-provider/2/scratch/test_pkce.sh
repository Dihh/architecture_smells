#!/bin/bash
BASE_URL="http://localhost:4000"

# PKCE generation in bash
VERIFIER="this-is-a-very-long-and-secure-verifier-string-1234567890"
# SHA256 -> base64 -> base64url
CHALLENGE=$(echo -n "$VERIFIER" | openssl dgst -sha256 -binary | base64 | tr '+/' '-_' | tr -d '=')

echo "Verifier: $VERIFIER"
echo "Challenge: $CHALLENGE"

echo -e "\n1. Getting Auth Code with PKCE..."
LOCATION=$(curl -v -s -X POST $BASE_URL/oauth2/authorize \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "client_id=test-client" \
  -d "redirect_uri=http://localhost:8080/callback" \
  -d "response_type=code" \
  -d "scope=openid" \
  -d "state=xyz123" \
  -d "username=testuser" \
  -d "password=password123" \
  -d "code_challenge=$CHALLENGE" \
  -d "code_challenge_method=S256" 2>&1 | grep "Location:" | awk '{print $3}' | tr -d '\r')

CODE=$(echo $LOCATION | sed -n 's/.*code=\([^&]*\).*/\1/p')
echo "Auth Code: $CODE"

echo -e "\n2. Exchange WITHOUT verifier (should fail 400 invalid_grant)..."
curl -s -X POST $BASE_URL/oauth2/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=authorization_code" \
  -d "code=$CODE" \
  -d "redirect_uri=http://localhost:8080/callback" \
  -d "client_id=test-client" \
  -d "client_secret=test-secret" | jq .

echo -e "\n3. Exchange with WRONG verifier (should fail 400 invalid_grant)..."
curl -s -X POST $BASE_URL/oauth2/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=authorization_code" \
  -d "code=$CODE" \
  -d "redirect_uri=http://localhost:8080/callback" \
  -d "client_id=test-client" \
  -d "client_secret=test-secret" \
  -d "code_verifier=wrong" | jq .

echo -e "\n4. Exchange with CORRECT verifier (should succeed)..."
curl -s -X POST $BASE_URL/oauth2/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=authorization_code" \
  -d "code=$CODE" \
  -d "redirect_uri=http://localhost:8080/callback" \
  -d "client_id=test-client" \
  -d "client_secret=test-secret" \
  -d "code_verifier=$VERIFIER" | jq .
