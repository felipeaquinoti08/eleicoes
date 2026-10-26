#!/usr/bin/env bash
# Cria no Azure tudo o que o Apuração de Eleições precisa para guardar os dados no Blob.
# Rode no Azure Cloud Shell (Bash) ou com a Azure CLI logada (az login). Não grava nenhum segredo em arquivo:
# o segredo do service principal aparece UMA vez no final, para você copiar para o .env do servidor.
#
#   CONTA=eleicoesdados123 RG=rg-eleicoes LOCAL=brazilsouth bash azure/configurar.sh
#
set -euo pipefail
: "${CONTA:?defina CONTA (nome da storage account: 3 a 24 letras minúsculas e números, único no Azure)}"
RG="${RG:-rg-eleicoes}"
LOCAL="${LOCAL:-brazilsouth}"
PUBLICO="${PUBLICO:-eleicoes}"
INTERNO="${INTERNO:-eleicoes-interno}"
VALIDADE_SAS="${VALIDADE_SAS:-$(date -u -d '+1 year' +%Y-%m-%d 2>/dev/null || date -u -v+1y +%Y-%m-%d)}"
DIR="$(cd "$(dirname "$0")" && pwd)"
SUB="$(az account show --query id -o tsv)"
CONTA_ID="/subscriptions/$SUB/resourceGroups/$RG/providers/Microsoft.Storage/storageAccounts/$CONTA"

echo "== storage account $CONTA ($LOCAL)"
az group create -n "$RG" -l "$LOCAL" -o none
# privada (sem acesso anônimo), só HTTPS e TLS 1.2+. A chave compartilhada continua ativa só porque é ela que
# assina o SAS de leitura do Cloudflare; a chave em si nunca sai do Azure (nem para o .env, nem para o Cloudflare).
az storage account create -n "$CONTA" -g "$RG" -l "$LOCAL" --sku Standard_LRS --kind StorageV2 \
  --https-only true --min-tls-version TLS1_2 --allow-blob-public-access false -o none
# lixeira de 30 dias e versionamento: nada sobrescrito ou apagado se perde
az storage account blob-service-properties update --account-name "$CONTA" -g "$RG" \
  --enable-delete-retention true --delete-retention-days 30 \
  --enable-container-delete-retention true --container-delete-retention-days 30 \
  --enable-versioning true -o none
# o snapshot da apuração é regravado a cada 30 s: versões com mais de 7 dias são apagadas pelo próprio Azure
az storage account management-policy create --account-name "$CONTA" -g "$RG" --policy @"$DIR/ciclo-de-vida.json" -o none

echo "== containers $PUBLICO (lido pelo Cloudflare) e $INTERNO (só o servidor)"
for c in "$PUBLICO" "$INTERNO"; do
  az storage container create --account-name "$CONTA" -n "$c" --public-access off --auth-mode key -o none
done

echo "== papel personalizado (ler e gravar, sem apagar)"
if ! az role definition list --name "Eleicoes Gravador Blob" --query "[0].id" -o tsv | grep -q .; then
  sed "s#/subscriptions/SUBSCRIPTION_ID#/subscriptions/$SUB#" "$DIR/papel-gravador.json" > /tmp/papel-gravador.json
  az role definition create --role-definition @/tmp/papel-gravador.json -o none
  rm -f /tmp/papel-gravador.json
  sleep 30 # o papel novo demora alguns segundos para ficar disponível
fi

echo "== service principal do servidor"
SP_JSON="$(az ad sp create-for-rbac --name "apuracao-eleicoes-gravador" --years 1 -o json)"
APP_ID="$(echo "$SP_JSON" | sed -n 's/.*"appId": *"\([^"]*\)".*/\1/p')"
TENANT="$(echo "$SP_JSON" | sed -n 's/.*"tenant": *"\([^"]*\)".*/\1/p')"
SEGREDO="$(echo "$SP_JSON" | sed -n 's/.*"password": *"\([^"]*\)".*/\1/p')"
sleep 20 # propagação do service principal no Entra ID
for c in "$PUBLICO" "$INTERNO"; do
  az role assignment create --assignee "$APP_ID" --role "Eleicoes Gravador Blob" \
    --scope "$CONTA_ID/blobServices/default/containers/$c" -o none
done

echo "== SAS só de leitura do container $PUBLICO, para o Cloudflare"
# política de acesso armazenada: para revogar o SAS, basta apagar a política "leitura-cdn"
az storage container policy create --account-name "$CONTA" -c "$PUBLICO" --name leitura-cdn \
  --permissions r --expiry "${VALIDADE_SAS}T00:00:00Z" --auth-mode key -o none 2>/dev/null || true
SAS="$(az storage container generate-sas --account-name "$CONTA" -n "$PUBLICO" --policy-name leitura-cdn --https-only --auth-mode key -o tsv)"

cat <<FIM

Pronto. Copie para o .env do servidor (não para o Git):

AZURE_STORAGE_ACCOUNT=$CONTA
AZURE_CONTAINER_PUBLICO=$PUBLICO
AZURE_CONTAINER_INTERNO=$INTERNO
AZURE_TENANT_ID=$TENANT
AZURE_CLIENT_ID=$APP_ID
AZURE_CLIENT_SECRET=$SEGREDO
AZURE_CLIENT_SECRET_EXPIRA=$(date -u -d '+1 year' +%Y-%m-%d 2>/dev/null || date -u -v+1y +%Y-%m-%d)

SAS de leitura para o Cloudflare (vai na regra de reescrita ou no secret do Worker, nunca no servidor):
$SAS

No Cloudflare (DNS):
  asverify.<subdomínio-dos-dados>  CNAME  asverify.$CONTA.blob.core.windows.net   (sem proxy)
  <subdomínio-dos-dados>           CNAME  $CONTA.blob.core.windows.net            (com proxy)
Depois que o DNS propagar, registre o domínio no Azure:
  az storage account update -g $RG -n $CONTA --custom-domain <subdomínio-dos-dados> --use-subdomain true
FIM
