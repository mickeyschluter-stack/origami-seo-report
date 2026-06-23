#!/bin/bash
# Wacoal SEO Report — Netlify Deployment Script

set -e

echo "=== Wacoal SEO Report — Netlify Deploy ==="

npm install
npm run build

netlify deploy --prod --dir dist --functions netlify/functions --site wacoal-seo

echo ""
echo "=== Deployed. Verify https://wacoal-seo.netlify.app/api/health ==="
