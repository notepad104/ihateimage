#!/usr/bin/env bash
# Deploy ihateimage to AWS: CloudFormation (S3 + CloudFront) then upload the build.
#
# Usage:
#   bash deploy/aws/deploy.sh                       # first run creates the stack, later runs update it
#   DOMAIN=tools.example.com CERT_ARN=arn:aws:acm:us-east-1:...:certificate/... HOSTED_ZONE_ID=Z123 bash deploy/aws/deploy.sh
#
# Requires: AWS CLI v2 with credentials that can manage CloudFormation, S3, CloudFront (and Route 53 if HOSTED_ZONE_ID is set).
set -euo pipefail
cd "$(dirname "$0")/../.."

STACK="${STACK:-ihateimage}"
REGION="${AWS_REGION:-us-east-1}"   # CloudFront is global; certificates it uses must live in us-east-1.
DOMAIN="${DOMAIN:-}"
CERT_ARN="${CERT_ARN:-}"
HOSTED_ZONE_ID="${HOSTED_ZONE_ID:-}"
PRICE_CLASS="${PRICE_CLASS:-PriceClass_100}"

if [[ -n "$DOMAIN" && -z "$CERT_ARN" ]]; then
  echo "DOMAIN is set but CERT_ARN is empty. Request a certificate first:" >&2
  echo "  aws acm request-certificate --region us-east-1 --domain-name $DOMAIN --validation-method DNS" >&2
  exit 1
fi

echo "==> Creating/updating stack $STACK in $REGION"
aws cloudformation deploy \
  --region "$REGION" \
  --stack-name "$STACK" \
  --template-file deploy/aws/template.yaml \
  --no-fail-on-empty-changeset \
  --parameter-overrides \
    "DomainName=$DOMAIN" \
    "CertificateArn=$CERT_ARN" \
    "HostedZoneId=$HOSTED_ZONE_ID" \
    "PriceClass=$PRICE_CLASS"

output() {
  aws cloudformation describe-stacks --region "$REGION" --stack-name "$STACK" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}
BUCKET="$(output BucketName)"
DIST_ID="$(output DistributionId)"
SITE_URL="$(output SiteUrl)"

echo "==> Building with VITE_SITE_URL=$SITE_URL"
VITE_SITE_URL="$SITE_URL" npm run build

echo "==> Uploading to s3://$BUCKET"
# Hashed assets never change: cache for a year.
aws s3 sync dist/assets "s3://$BUCKET/assets" --region "$REGION" --delete \
  --cache-control "public, max-age=31536000, immutable"
# HTML, sitemap, manifest, icons: always revalidate.
aws s3 sync dist "s3://$BUCKET" --region "$REGION" --delete --exclude "assets/*" \
  --exclude "_headers" --exclude "_redirects" \
  --cache-control "no-cache"

# The CLI guesses MIME types from extensions; make sure the ones browsers are picky about are right.
find dist/assets -name '*.wasm' -print0 | while IFS= read -r -d '' f; do
  aws s3 cp "$f" "s3://$BUCKET/assets/$(basename "$f")" --region "$REGION" \
    --content-type application/wasm --cache-control "public, max-age=31536000, immutable" --only-show-errors
done
aws s3 cp dist/manifest.webmanifest "s3://$BUCKET/manifest.webmanifest" --region "$REGION" \
  --content-type application/manifest+json --cache-control "no-cache" --only-show-errors

echo "==> Invalidating CloudFront cache"
aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths "/*" --query 'Invalidation.Id' --output text

echo
echo "Deployed: $SITE_URL"
if [[ -n "$DOMAIN" && -z "$HOSTED_ZONE_ID" ]]; then
  echo "Point $DOMAIN at $(output DistributionDomainName) with a CNAME (or ALIAS) record at your DNS provider."
fi
