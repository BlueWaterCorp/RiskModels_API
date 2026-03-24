#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const yamlPath = path.join(__dirname, '../OPENAPI_SPEC.yaml');
const jsonPath = path.join(__dirname, '../public/openapi.json');
const mcpJsonPath = path.join(__dirname, '../mcp-server/data/openapi.json');

try {
  const yamlContent = fs.readFileSync(yamlPath, 'utf8');
  const jsonContent = yaml.load(yamlContent);
  const jsonText = JSON.stringify(jsonContent, null, 2);

  // Ensure public directory exists
  const publicDir = path.dirname(jsonPath);
  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
  }

  fs.writeFileSync(jsonPath, jsonText);
  console.log('✓ Converted OPENAPI_SPEC.yaml to public/openapi.json');

  const mcpDir = path.dirname(mcpJsonPath);
  if (!fs.existsSync(mcpDir)) {
    fs.mkdirSync(mcpDir, { recursive: true });
  }
  fs.writeFileSync(mcpJsonPath, jsonText);
  console.log('✓ Mirrored to mcp-server/data/openapi.json');
} catch (error) {
  console.error('Error converting YAML to JSON:', error);
  process.exit(1);
}
