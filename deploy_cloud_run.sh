#!/bin/bash
# ==============================================================================
# CineOps Guard — GCP Cloud Run Deployment Script
# ==============================================================================
# Deploys the CineOps Guard API Gateway & MCP Server to Google Cloud Run.
#
# Usage:
#   chmod +x deploy_cloud_run.sh
#   ./deploy_cloud_run.sh [PROJECT_ID] [REGION]
# ==============================================================================

set -e

PROJECT_ID=${1:-${GCP_PROJECT_ID:-"cineops-guard-demo"}}
REGION=${2:-"us-central1"}
SERVICE_NAME="cineops-guard-api"
IMAGE_NAME="gcr.io/${PROJECT_ID}/${SERVICE_NAME}:latest"

echo "🚀 Deploying CineOps Guard to GCP Cloud Run"
echo "   Project ID: ${PROJECT_ID}"
echo "   Region:     ${REGION}"
echo "   Image:      ${IMAGE_NAME}"

# 1. Enable Required GCP APIs
echo "\n📌 Enabling GCP Cloud Run & Container Registry APIs..."
gcloud services enable run.googleapis.com containerregistry.googleapis.com secretmanager.googleapis.com --project="${PROJECT_ID}"

# 2. Build Container Image using Cloud Build
echo "\n📦 Building Docker Image with Cloud Build..."
gcloud builds submit --tag "${IMAGE_NAME}" --project="${PROJECT_ID}"

# 3. Deploy to Cloud Run
echo "\n☁️ Deploying Service to Cloud Run..."
gcloud run deploy "${SERVICE_NAME}" \
  --image "${IMAGE_NAME}" \
  --platform managed \
  --region "${REGION}" \
  --allow-unauthenticated \
  --set-env-vars GEMINI_MODEL="gemini-2.5-flash",GCP_PROJECT_ID="${PROJECT_ID}" \
  --project="${PROJECT_ID}"

echo "\n🎉 Cloud Run deployment complete! Service URL:"
gcloud run services describe "${SERVICE_NAME}" --platform managed --region "${REGION}" --format 'value(status.url)' --project="${PROJECT_ID}"
