#!/bin/bash
# sh ./test/runbasiccommands.sh
# A simple script to run basic commands to verify the setup of the project.
# Make sure you have Node.js and npm installed.

echo "Running basic commands to verify setup..."
echo "================================================="
echo "Cleaning up old logs..."
echo "rm -rf ./logs/*"
rm -rf ./logs/*

echo "================================================="
echo "Building the project..."
echo "npm run build"
npm run build

echo "================================================="
echo "displaying help..."
echo "npm --silent run start -- --help"
npm --silent run start -- --help

echo "================================================="
echo "Testing Actual connection..."
echo "npm --silent run start -- --test-actual-connection"
npm --silent run start -- --test-actual-connection

echo "================================================="
echo "Testing Actual tools..."
echo "npm --silent run start -- --test-actual-tools"
npm --silent run start -- --test-actual-tools

echo "================================================="
echo "Testing LibreChat Docker integration..."
echo "npm run test:librechat"
npm run test:librechat

echo "================================================="
echo "Running Docker Actual + fake data integration test..."
echo "npm run test:docker-actual"
npm run test:docker-actual

echo "================================================="
echo "Running ALL comprehensive tests..."
echo "npm run test:all"
npm run test:all

echo "================================================="
echo "Running FULL STACK E2E integration test..."
echo "npm run test:e2e-full-stack"
npm run test:e2e-full-stack

echo "================================================="
echo "Starting server with HTTP..."
echo "npm --silent run start -- --http --debug"
npm --silent run start -- --http --debug
