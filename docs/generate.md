# Generate Operation

The `generate` operation creates StackQL provider extensions from OpenAPI specifications and mapping configurations.

## Overview

After splitting an OpenAPI specification into service files and creating a mapping configuration, the `generate` operation transforms these inputs into a complete StackQL provider. The generated provider includes all the necessary components for StackQL to interact with the API, including resource definitions, method mappings, authentication configurations, and endpoint information.

## Function Signature

```javascript
async function generate(options) {
  // Implementation details
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `inputDir` | string | Yes | Directory containing split service files |
| `outputDir` | string | Yes | Directory for generated provider |
| `configPath` | string | Yes | Path to mapping configuration CSV |
| `providerId` | string | Yes | Provider identifier |
| `servers` | Array\<Object\> | No | Server configuration (URLs, variables) |
| `providerConfig` | Object | No | Provider-specific configuration (auth, etc.) |
| `serviceConfig` | Object | No | Service-level configuration injected as `x-stackQL-config` at the root of each service spec (e.g., pagination settings) |
| `naiveReqBodyTranslate` | boolean | No | When `true`, adds `config.requestBodyTranslate.algorithm: naive` to every method with a request body (POST, PUT, PATCH). Also causes doc generation to omit the `data__` prefix on insert/update/replace fields. (default: false) |
| `skipFiles` | Array\<string\> | No | List of files to skip during generation |
| `overwrite` | boolean | No | Whether to overwrite existing files (default: false) |
| `verbose` | boolean | No | Whether to output detailed logs (default: false) |

### Server Configuration

The `servers` parameter defines the base URL(s) for API requests, including any variable placeholders:

```javascript
servers: [
  {
    "url": "https://{subdomain}.api.example.com/v1",
    "variables": {
      "subdomain": {
        "default": "api",
        "description": "Your API subdomain"
      }
    }
  }
]
```

### Provider Configuration

The `providerConfig` parameter defines authentication and other provider-specific settings:

```javascript
providerConfig: {
  "config": {
    "auth": {
      "type": "api_key",
      "credentialsenvvar": "API_KEY",
      "valuePrefix": "Bearer "
    }
  }
}
```

## Return Value

The function returns a Promise that resolves to an object containing:

```javascript
{
  serviceCount: number,      // Number of services processed
  resourceCount: number,     // Number of resources created
  methodCount: number,       // Number of methods created
  outputDirectory: string    // Path to the output directory
}
```

## Example Usage

```javascript
import { providerdev } from '@stackql/provider-utils';

async function generateExample() {
  try {
    const result = await providerdev.generate({
      inputDir: './output/split/github',
      outputDir: './output/generate/github',
      configPath: './config/mapping/github/all_services.csv',
      providerId: 'github',
      servers: [
        {
          "url": "https://api.github.com",
          "description": "GitHub API endpoint"
        }
      ],
      providerConfig: {
        "config": {
          "auth": {
            "type": "bearer",
            "credentialsenvvar": "GITHUB_TOKEN"
          }
        }
      },
      overwrite: true,
      verbose: true
    });
    
    console.log(`Provider generation completed successfully!`);
    console.log(`Processed ${result.serviceCount} services.`);
    console.log(`Created ${result.resourceCount} resources with ${result.methodCount} methods.`);
    console.log(`Output directory: ${result.outputDirectory}`);
  } catch (error) {
    console.error('Error generating provider extensions:', error);
  }
}

generateExample();
```

## Output Structure

The generate operation creates the following directory structure:

```
outputDir/
├── {providerId}/
│   └── v00.00.00000/           # Version directory
│       ├── provider.yaml       # Main provider definition
│       └── services/           # Service definitions
│           ├── service1.yaml
│           ├── service2.yaml
│           └── ...
```

## Authentication Types

StackQL supports various authentication types, which can be configured in the `providerConfig` parameter:

### API Key Authentication

```javascript
providerConfig: {
  "config": {
    "auth": {
      "type": "api_key",
      "credentialsenvvar": "API_KEY",
      "in": "header",         // or "query"
      "name": "Authorization", // Header name or query parameter
      "valuePrefix": "Bearer " // Optional prefix
    }
  }
}
```

### Basic Authentication

```javascript
providerConfig: {
  "config": {
    "auth": {
      "type": "basic",
      "credentialsenvvar": "BASIC_AUTH" // username:password
    }
  }
}
```

### OAuth Authentication

```javascript
providerConfig: {
  "config": {
    "auth": {
      "type": "oauth",
      "tokenenvvar": "OAUTH_TOKEN"
    }
  }
}
```
