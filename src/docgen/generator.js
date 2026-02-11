// src/docgen/generator.js

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { createResourceIndexContent, createResourceIndexContentv2 } from './resource-content.js';
import SwaggerParser from '@apidevtools/swagger-parser';
import * as deno_openapi_dereferencer from "@stackql/deno-openapi-dereferencer";

export async function generateDocs(options) {
    const {
        providerName,
        providerDir,        // e.g., 'output/src/heroku/v00.00.00000'
        outputDir,          // e.g., 'website'
        providerDataDir,    // e.g., 'config/provider-data'
        dereferenced = false,
    } = options;

    console.log(`documenting ${providerName}...`);

    const docsDir = path.join(outputDir, `docs`);
    const servicesDir = path.join(docsDir, `services`);
   
    // Remove directory if it exists, then create it fresh
    fs.existsSync(docsDir) && fs.rmSync(docsDir, { recursive: true, force: true });
    fs.mkdirSync(servicesDir, { recursive: true });

    // Check for provider data files
    console.log(providerDataDir);
    try {
        const files = fs.readdirSync(providerDataDir);
        console.log('Files in providerDataDir:', files);
    } catch (err) {
        console.error('Error reading providerDataDir:', err.message);
    }

    const headerContent1Path = path.join(providerDataDir, 'headerContent1.txt');
    const headerContent2Path = path.join(providerDataDir, 'headerContent2.txt');

    if (!fs.existsSync(headerContent1Path) || !fs.existsSync(headerContent2Path)) {
        throw new Error(`Missing headerContent1.txt or headerContent2.txt in ${providerDataDir}`);
    }

    const headerContent1 = fs.readFileSync(headerContent1Path, 'utf8');
    const headerContent2 = fs.readFileSync(headerContent2Path, 'utf8');

    // Initialize counters
    let servicesForIndex = [];
    let totalServicesCount = 0;
    let totalResourcesCount = 0;

    // Process services
    const serviceDir = path.join(providerDir, 'services');
    console.log(`Processing services in ${serviceDir}...`);
    const serviceFiles = fs.readdirSync(serviceDir).filter(file => path.extname(file) === '.yaml');

    for (const file of serviceFiles) {
        const serviceName = path.basename(file, '.yaml').replace(/-/g, '_');
        console.log(`Processing service: ${serviceName}`);
        servicesForIndex.push(serviceName);
        const filePath = path.join(serviceDir, file);
        totalServicesCount++;
        const serviceFolder = `${servicesDir}/${serviceName}`;
        await createDocsForService(filePath, providerName, serviceName, serviceFolder, dereferenced);
    }

    console.log(`Processed ${totalServicesCount} services`);

    // Count total resources
    totalResourcesCount = fs.readdirSync(`${servicesDir}`, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => fs.readdirSync(`${servicesDir}/${dirent.name}`).length)
        .reduce((a, b) => a + b, 0);

    console.log(`Processed ${totalResourcesCount} resources`);

    // Create provider index
    servicesForIndex = [...new Set(servicesForIndex)];
    servicesForIndex.sort();

    const half = Math.ceil(servicesForIndex.length / 2);
    const firstColumnServices = servicesForIndex.slice(0, half);
    const secondColumnServices = servicesForIndex.slice(half);

    const indexContent = `${headerContent1}

:::info[Provider Summary] 

total services: __${totalServicesCount}__  
total resources: __${totalResourcesCount}__  

:::

${headerContent2}

## Services
<div class="row">
<div class="providerDocColumn">
${servicesToMarkdown(providerName, firstColumnServices)}
</div>
<div class="providerDocColumn">
${servicesToMarkdown(providerName, secondColumnServices)}
</div>
</div>
`;

    // Write index
    const indexPath = path.join(docsDir, 'index.md');
    fs.writeFileSync(indexPath, indexContent);
    console.log(`Index file created at ${indexPath}`);

    return {
        totalServices: totalServicesCount,
        totalResources: totalResourcesCount,
        outputPath: docsDir
    };
}

// Process each service sequentially
async function createDocsForService(yamlFilePath, providerName, serviceName, serviceFolder, dereferenced = false) {

    const data = yaml.load(fs.readFileSync(yamlFilePath, 'utf8'));

    // Create a new SwaggerParser instance
    let parser = new SwaggerParser();
    const api = await parser.parse(yamlFilePath); 
    const ignorePaths = ["$.components.x-stackQL-resources"];
    let dereferencedAPI;

    if (dereferenced) {
        // If API is already dereferenced, just use it as is
        dereferencedAPI = api;
    } else {
        try {
            // Only dereference and flatten if needed
            dereferencedAPI = await SwaggerParser.dereference(api);
            dereferencedAPI = await deno_openapi_dereferencer.flattenAllOf(dereferencedAPI);
        } catch (error) {
            console.error("error in dereferencing or flattening:", error);
        }
    }

    // Create service directory
    if (!fs.existsSync(serviceFolder)) {
        fs.mkdirSync(serviceFolder, { recursive: true });
    }

    const resourcesObj = data.components['x-stackQL-resources'];

    if (!resourcesObj) {
        console.warn(`No resources found in ${yamlFilePath}`);
        return;
    }

    const resources = [];
    for (let resourceName in resourcesObj) {
    
        let resourceData = resourcesObj[resourceName];
        if (!resourceData.id) {
            console.warn(`No 'id' defined for resource: ${resourceName} in service: ${serviceName}`);
            continue;
        }

        const resourceDescription = resourceData.description || '';

        // Determine if it's a View or a Resource
        let resourceType = "Resource"; // Default type
        if (resourceData.config?.views?.select) {
            resourceType = "View";
        }
        
        resources.push({
            name: resourceName,
            description: resourceDescription,
            type: resourceType,
            resourceData,
            dereferencedAPI,
        });
    }    

    // Process service index
    const serviceIndexPath = path.join(serviceFolder, 'index.md');
    const serviceIndexContent = await createServiceIndexContent(providerName, serviceName, resources);
    fs.writeFileSync(serviceIndexPath, serviceIndexContent);

    // Split into columns and process resources one by one
    const halfLength = Math.ceil(resources.length / 2);
    const firstColumn = resources.slice(0, halfLength);
    const secondColumn = resources.slice(halfLength);

    // Process each resource in first column
    for (const resource of firstColumn) {
        await processResource(providerName, serviceFolder, serviceName, resource);
    }

    // Process each resource in second column
    for (const resource of secondColumn) {
        await processResource(providerName, serviceFolder, serviceName, resource);
    }

    console.log(`Generated documentation for ${serviceName}`);
}

async function processResource(providerName, serviceFolder, serviceName, resource) {
    console.log(`Processing resource: ${resource.name}`);
    
    const resourceFolder = path.join(serviceFolder, resource.name);
    if (!fs.existsSync(resourceFolder)) {
        fs.mkdirSync(resourceFolder, { recursive: true });
    }

    const resourceIndexPath = path.join(resourceFolder, 'index.md');
    const resourceIndexContent = await createResourceIndexContent(
        providerName, 
        serviceName, 
        resource,
    );
    fs.writeFileSync(resourceIndexPath, resourceIndexContent);

    // After writing the file, force garbage collection if available (optional)
    if (global.gc) {
        global.gc();
    }
}

async function createServiceIndexContent(providerName, serviceName, resources) {
    const totalResources = resources.length; // Calculate the total resources

    // Sort resources alphabetically by name
    resources.sort((a, b) => a.name.localeCompare(b.name));

    const halfLength = Math.ceil(totalResources / 2);
    const firstColumnResources = resources.slice(0, halfLength);
    const secondColumnResources = resources.slice(halfLength);

    // Generate the HTML for resource links in the first column
    const firstColumnLinks = generateResourceLinks(providerName, serviceName, firstColumnResources);

    // Generate the HTML for resource links in the second column
    const secondColumnLinks = generateResourceLinks(providerName, serviceName, secondColumnResources);

    // Create the markdown content for the service index
    // You can customize this content as needed
    return `---
title: ${serviceName}
hide_title: false
hide_table_of_contents: false
keywords:
  - ${serviceName}
  - ${providerName}
  - stackql
  - infrastructure-as-code
  - configuration-as-data
  - cloud inventory
description: Query, deploy and manage ${providerName} resources using SQL
custom_edit_url: null
image: /img/stackql-${providerName}-provider-featured-image.png
---

${serviceName} service documentation.

:::info[Service Summary]

total resources: __${totalResources}__  

:::

## Resources
<div class="row">
<div class="providerDocColumn">
${firstColumnLinks}
</div>
<div class="providerDocColumn">
${secondColumnLinks}
</div>
</div>`;
}

function generateResourceLinks(providerName, serviceName, resources) {
    // Generate resource links for the service index
    const resourceLinks = resources.map((resource) => {
        return `<a href="/services/${serviceName}/${resource.name}/">${resource.name}</a>`;
    });
    return resourceLinks.join('<br />\n');
}

export async function generateDocsv2(options) {
    const {
        providerName,
        providerDir,        // e.g., 'output/src/heroku/v00.00.00000'
        outputDir,          // e.g., 'website'
        providerDataDir,    // e.g., 'config/provider-data'
        dereferenced = false,
    } = options;

    console.log(`documenting ${providerName} (v2)...`);

    const docsDir = path.join(outputDir, `docs`);
    const servicesDir = path.join(docsDir, `services`);

    // Remove directory if it exists, then create it fresh
    fs.existsSync(docsDir) && fs.rmSync(docsDir, { recursive: true, force: true });
    fs.mkdirSync(servicesDir, { recursive: true });

    // Check for provider data files
    console.log(providerDataDir);
    try {
        const files = fs.readdirSync(providerDataDir);
        console.log('Files in providerDataDir:', files);
    } catch (err) {
        console.error('Error reading providerDataDir:', err.message);
    }

    const headerContent1Path = path.join(providerDataDir, 'headerContent1.txt');
    const headerContent2Path = path.join(providerDataDir, 'headerContent2.txt');

    if (!fs.existsSync(headerContent1Path) || !fs.existsSync(headerContent2Path)) {
        throw new Error(`Missing headerContent1.txt or headerContent2.txt in ${providerDataDir}`);
    }

    const headerContent1 = fs.readFileSync(headerContent1Path, 'utf8');
    const headerContent2 = fs.readFileSync(headerContent2Path, 'utf8');

    // Initialize counters
    let servicesForIndex = [];
    let totalServicesCount = 0;
    let totalResourcesCount = 0;

    // Process services
    const serviceDir = path.join(providerDir, 'services');
    console.log(`Processing services in ${serviceDir}...`);
    const serviceFiles = fs.readdirSync(serviceDir).filter(file => path.extname(file) === '.yaml');

    for (const file of serviceFiles) {
        const serviceName = path.basename(file, '.yaml').replace(/-/g, '_');
        console.log(`Processing service: ${serviceName}`);
        servicesForIndex.push(serviceName);
        const filePath = path.join(serviceDir, file);
        totalServicesCount++;
        const serviceFolder = `${servicesDir}/${serviceName}`;
        await createDocsForServicev2(filePath, providerName, serviceName, serviceFolder, dereferenced);
    }

    console.log(`Processed ${totalServicesCount} services`);

    // Count total resources
    totalResourcesCount = fs.readdirSync(`${servicesDir}`, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => fs.readdirSync(`${servicesDir}/${dirent.name}`).length)
        .reduce((a, b) => a + b, 0);

    console.log(`Processed ${totalResourcesCount} resources`);

    // Create provider index
    servicesForIndex = [...new Set(servicesForIndex)];
    servicesForIndex.sort();

    const half = Math.ceil(servicesForIndex.length / 2);
    const firstColumnServices = servicesForIndex.slice(0, half);
    const secondColumnServices = servicesForIndex.slice(half);

    const indexContent = `${headerContent1}

:::info[Provider Summary]

total services: __${totalServicesCount}__
total resources: __${totalResourcesCount}__

:::

${headerContent2}

## Services
<div class="row">
<div class="providerDocColumn">
${servicesToMarkdown(providerName, firstColumnServices)}
</div>
<div class="providerDocColumn">
${servicesToMarkdown(providerName, secondColumnServices)}
</div>
</div>
`;

    // Write index
    const indexPath = path.join(docsDir, 'index.md');
    fs.writeFileSync(indexPath, indexContent);
    console.log(`Index file created at ${indexPath}`);

    return {
        totalServices: totalServicesCount,
        totalResources: totalResourcesCount,
        outputPath: docsDir
    };
}

// v2 service processing - uses SchemaTable for collapsible nested fields
async function createDocsForServicev2(yamlFilePath, providerName, serviceName, serviceFolder, dereferenced = false) {

    const data = yaml.load(fs.readFileSync(yamlFilePath, 'utf8'));

    // Create a new SwaggerParser instance
    let parser = new SwaggerParser();
    const api = await parser.parse(yamlFilePath);
    const ignorePaths = ["$.components.x-stackQL-resources"];
    let dereferencedAPI;

    if (dereferenced) {
        // If API is already dereferenced, just use it as is
        dereferencedAPI = api;
    } else {
        try {
            // Only dereference and flatten if needed
            dereferencedAPI = await SwaggerParser.dereference(api);
            dereferencedAPI = await deno_openapi_dereferencer.flattenAllOf(dereferencedAPI);
        } catch (error) {
            console.error("error in dereferencing or flattening:", error);
        }
    }

    // Create service directory
    if (!fs.existsSync(serviceFolder)) {
        fs.mkdirSync(serviceFolder, { recursive: true });
    }

    const resourcesObj = data.components['x-stackQL-resources'];

    if (!resourcesObj) {
        console.warn(`No resources found in ${yamlFilePath}`);
        return;
    }

    const resources = [];
    for (let resourceName in resourcesObj) {

        let resourceData = resourcesObj[resourceName];
        if (!resourceData.id) {
            console.warn(`No 'id' defined for resource: ${resourceName} in service: ${serviceName}`);
            continue;
        }

        const resourceDescription = resourceData.description || '';

        // Determine if it's a View or a Resource
        let resourceType = "Resource"; // Default type
        if (resourceData.config?.views?.select) {
            resourceType = "View";
        }

        resources.push({
            name: resourceName,
            description: resourceDescription,
            type: resourceType,
            resourceData,
            dereferencedAPI,
        });
    }

    // Process service index
    const serviceIndexPath = path.join(serviceFolder, 'index.md');
    const serviceIndexContent = await createServiceIndexContent(providerName, serviceName, resources);
    fs.writeFileSync(serviceIndexPath, serviceIndexContent);

    // Split into columns and process resources one by one
    const halfLength = Math.ceil(resources.length / 2);
    const firstColumn = resources.slice(0, halfLength);
    const secondColumn = resources.slice(halfLength);

    // Process each resource in first column
    for (const resource of firstColumn) {
        await processResourcev2(providerName, serviceFolder, serviceName, resource);
    }

    // Process each resource in second column
    for (const resource of secondColumn) {
        await processResourcev2(providerName, serviceFolder, serviceName, resource);
    }

    console.log(`Generated documentation (v2) for ${serviceName}`);
}

async function processResourcev2(providerName, serviceFolder, serviceName, resource) {
    console.log(`Processing resource (v2): ${resource.name}`);

    const resourceFolder = path.join(serviceFolder, resource.name);
    if (!fs.existsSync(resourceFolder)) {
        fs.mkdirSync(resourceFolder, { recursive: true });
    }

    const resourceIndexPath = path.join(resourceFolder, 'index.md');
    const resourceIndexContent = await createResourceIndexContentv2(
        providerName,
        serviceName,
        resource,
    );
    fs.writeFileSync(resourceIndexPath, resourceIndexContent);

    // After writing the file, force garbage collection if available (optional)
    if (global.gc) {
        global.gc();
    }
}

// Function to convert services to markdown links
function servicesToMarkdown(providerName, servicesList) {
    return servicesList.map(service => `<a href="/services/${service}/">${service}</a><br />`).join('\n');
}