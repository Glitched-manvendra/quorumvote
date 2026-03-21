#!/usr/bin/env bash
set -e
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'

echo -e "${CYAN}QUORUMVOTE — DEPLOY${NC}"
echo ""

echo -e "${YELLOW}[1/6] Setting up identity...${NC}"
stellar keys generate --global deployer --network testnet 2>/dev/null || true
stellar keys fund deployer --network testnet
DEPLOYER=$(stellar keys address deployer)
echo -e "${GREEN}✓ Deployer: ${DEPLOYER}${NC}"

XLM_TOKEN=$(stellar contract id asset --asset native --network testnet)
echo -e "${GREEN}✓ XLM Token: ${XLM_TOKEN}${NC}"

echo -e "${YELLOW}[2/5] Building WASM...${NC}"
cd contract
cargo build --target wasm32-unknown-unknown --release
WASM="target/wasm32-unknown-unknown/release/quorumvote.wasm"
cd ..

echo -e "${YELLOW}[3/5] Uploading & Deploying...${NC}"
WASM_HASH=$(stellar contract upload --network testnet --source deployer --wasm contract/${WASM})
CONTRACT_ID=$(stellar contract deploy --network testnet --source deployer --wasm-hash ${WASM_HASH})
echo -e "${GREEN}✓ CONTRACT_ID: ${CONTRACT_ID}${NC}"

echo -e "${YELLOW}[4/5] Approving XLM...${NC}"
stellar contract invoke --network testnet --source deployer --id ${XLM_TOKEN} \
  -- approve --from ${DEPLOYER} --spender ${CONTRACT_ID} \
  --amount 50000000 --expiration_ledger 99999999 2>&1 || true

echo -e "${YELLOW}[5/5] Creating proof proposal + vote...${NC}"
# Create proposal (duration: 17280 ledgers ≈ 1 day)
stellar contract invoke --network testnet --source deployer --id ${CONTRACT_ID} \
  -- create_proposal \
  --creator ${DEPLOYER} \
  --question '"Should Stellar adopt a community grants programme for open-source tooling?"' \
  --duration_ledgers 17280 2>&1 || true

TX_RESULT=$(stellar contract invoke --network testnet --source deployer --id ${CONTRACT_ID} \
  -- vote \
  --voter ${DEPLOYER} \
  --proposal_id 1 \
  --vote_yes true \
  --stake 5000000 \
  --xlm_token ${XLM_TOKEN} 2>&1)

TX_HASH=$(echo "$TX_RESULT" | grep -oP '[0-9a-f]{64}' | head -1)
echo -e "${GREEN}✓ Proof TX: ${TX_HASH}${NC}"

cat > frontend/.env << EOF
VITE_CONTRACT_ID=${CONTRACT_ID}
VITE_XLM_TOKEN=${XLM_TOKEN}
VITE_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
VITE_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
EOF

echo ""
echo -e "${CYAN}CONTRACT : ${CONTRACT_ID}${NC}"
echo -e "${CYAN}PROOF TX : ${TX_HASH}${NC}"
echo -e "${CYAN}EXPLORER : https://stellar.expert/explorer/testnet/contract/${CONTRACT_ID}${NC}"
echo "Next: cd frontend && npm install && npm run dev"
