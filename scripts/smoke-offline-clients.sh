#!/usr/bin/env bash
set -euo pipefail

API="http://localhost:3011/api"
PASS=0
FAIL=0
OFFLINE_PHONE="+37529$(printf '%07d' $((RANDOM * RANDOM % 10000000)))"
REGISTER_EMAIL="smoke-offline-$(date +%s)@test.fitgo"
REGISTER_PASS="testpass123"

ok() { echo "✅ $1"; PASS=$((PASS + 1)); }
bad() { echo "❌ $1"; FAIL=$((FAIL + 1)); }

json() { node -e "const d=JSON.parse(process.argv[1]); console.log(d$(node -pe "process.argv[2]||''" "$2" 2>/dev/null || echo ''));" 2>/dev/null || echo "$1"; }

# 1. Trainer login
TRAINER_LOGIN=$(curl -sf -X POST "$API/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"trainer@demo.fitgo","password":"trainer123"}')
TRAINER_TOKEN=$(echo "$TRAINER_LOGIN" | node -pe 'JSON.parse(fs.readFileSync(0)).accessToken')
TRAINER_ID=$(echo "$TRAINER_LOGIN" | node -pe 'JSON.parse(fs.readFileSync(0)).user.id')
[[ -n "$TRAINER_TOKEN" ]] && ok "Trainer login" || bad "Trainer login"

# 2. List roster (demo client)
CLIENTS=$(curl -sf "$API/trainer/clients" -H "Authorization: Bearer $TRAINER_TOKEN")
CLIENT_COUNT=$(echo "$CLIENTS" | node -pe 'JSON.parse(fs.readFileSync(0)).length')
[[ "$CLIENT_COUNT" -ge 1 ]] && ok "GET /trainer/clients ($CLIENT_COUNT clients)" || bad "GET /trainer/clients"

# 3. Offline add — free phone
OFFLINE=$(curl -sf -X POST "$API/trainer/clients" \
  -H "Authorization: Bearer $TRAINER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"firstName\":\"Smoke\",\"lastName\":\"Offline\",\"phone\":\"$OFFLINE_PHONE\"}")
OFFLINE_ID=$(echo "$OFFLINE" | node -pe 'const j=JSON.parse(fs.readFileSync(0)); j.id||""')
if [[ -n "$OFFLINE_ID" ]]; then
  ok "POST offline client → id=$OFFLINE_ID"
else
  bad "POST offline client (got: $OFFLINE)"
fi

# 4. Offline add — busy phone → generic message (privacy)
BUSY=$(curl -sf -X POST "$API/trainer/clients" \
  -H "Authorization: Bearer $TRAINER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"firstName":"X","lastName":"Y","phone":"+375296600435"}')
BUSY_MSG=$(echo "$BUSY" | node -pe 'JSON.parse(fs.readFileSync(0)).message||""')
[[ "$BUSY_MSG" == *"приглашение"* || "$BUSY_MSG" == *"Приглашение"* ]] && ok "Busy phone → generic message" || bad "Busy phone privacy ($BUSY_MSG)"

# 5. Invite — same generic response
INVITE=$(curl -sf -X POST "$API/trainer/clients/invite" \
  -H "Authorization: Bearer $TRAINER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"phone":"+375296600435"}')
INVITE_MSG=$(echo "$INVITE" | node -pe 'JSON.parse(fs.readFileSync(0)).message||""')
[[ -n "$INVITE_MSG" ]] && ok "POST invite → generic message" || bad "POST invite"

# 6. Assign PT to offline client (CONFIRMED link, no clientAccepted yet)
DAY=$((10 + RANDOM % 18))
START_AT="2026-08-${DAY}T10:00:00.000Z"
ASSIGN_HTTP=$(curl -s -o /tmp/fitgo-assign.json -w "%{http_code}" -X POST "$API/trainer/personal-bookings" \
  -H "Authorization: Bearer $TRAINER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"clientId\":\"$OFFLINE_ID\",\"startAt\":\"$START_AT\"}")
if [[ "$ASSIGN_HTTP" == "201" ]]; then
  BOOKING_ID=$(node -pe 'JSON.parse(fs.readFileSync("/tmp/fitgo-assign.json")).id')
  ok "Assign PT to offline client (booking=$BOOKING_ID)"
else
  bad "Assign PT to offline client (HTTP $ASSIGN_HTTP: $(cat /tmp/fitgo-assign.json))"
fi

# 7. SHADOW cannot login (invalid email format → 400, or 401 if reached)
SHADOW_EMAIL=$(node -pe "const p=process.env.P.replace(/\\D/g,''); let d=p; if(d.length===9)d='375'+d; console.log('shadow+'+d+'@fitgo.internal')" -e "P=$OFFLINE_PHONE")
SHADOW_LOGIN=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$SHADOW_EMAIL\",\"password\":\"x\"}")
[[ "$SHADOW_LOGIN" == "401" || "$SHADOW_LOGIN" == "400" ]] && ok "SHADOW login rejected ($SHADOW_LOGIN)" || bad "SHADOW login (code=$SHADOW_LOGIN)"

# 8. Register activates SHADOW
REG=$(curl -sf -X POST "$API/auth/register" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$REGISTER_EMAIL\",\"password\":\"$REGISTER_PASS\",\"firstName\":\"Smoke\",\"lastName\":\"Activated\",\"phone\":\"$OFFLINE_PHONE\"}")
CLIENT_TOKEN=$(echo "$REG" | node -pe 'JSON.parse(fs.readFileSync(0)).accessToken')
PENDING=$(echo "$REG" | node -pe 'JSON.parse(fs.readFileSync(0)).pendingTrainers.length')
[[ -n "$CLIENT_TOKEN" ]] && ok "Register activates SHADOW" || bad "Register"
[[ "$PENDING" -ge 1 ]] && ok "Pending trainer on register ($PENDING)" || bad "Pending trainer on register ($PENDING)"

# 9. Client bookings hidden before accept
BOOKINGS_BEFORE=$(curl -sf "$API/client/bookings" -H "Authorization: Bearer $CLIENT_TOKEN")
PT_BEFORE=$(echo "$BOOKINGS_BEFORE" | node -pe 'JSON.parse(fs.readFileSync(0)).filter(b=>b.type==="PERSONAL").length')
[[ "$PT_BEFORE" == "0" ]] && ok "PT hidden before trainer accept" || bad "PT visible before accept ($PT_BEFORE)"

# 10. Accept trainer
ACCEPT=$(curl -sf -X POST "$API/client/trainer-invites/$TRAINER_ID/accept" \
  -H "Authorization: Bearer $CLIENT_TOKEN")
echo "$ACCEPT" | grep -q success && ok "Client accepts trainer" || bad "Client accept trainer"

# 11. PT visible after accept
BOOKINGS_AFTER=$(curl -sf "$API/client/bookings" -H "Authorization: Bearer $CLIENT_TOKEN")
PT_AFTER=$(echo "$BOOKINGS_AFTER" | node -pe 'JSON.parse(fs.readFileSync(0)).filter(b=>b.type==="PERSONAL").length')
[[ "$PT_AFTER" -ge 1 ]] && ok "PT visible after accept ($PT_AFTER)" || bad "PT not visible after accept"

# 12. Demo client login still works
CLIENT_LOGIN=$(curl -sf -X POST "$API/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"client@demo.fitgo","password":"client123"}')
[[ -n "$(echo "$CLIENT_LOGIN" | node -pe 'JSON.parse(fs.readFileSync(0)).accessToken')" ]] && ok "Demo client login" || bad "Demo client login"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Smoke: $PASS passed, $FAIL failed"
echo "Web UI: http://localhost:3010"
echo "API:    http://localhost:3011/api"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
[[ "$FAIL" -eq 0 ]]
