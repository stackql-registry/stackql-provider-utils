// src/docgen/resource-content.js

import { createOverviewSection, createOverviewSectionv2 } from './resource/overview.js';
import { createFieldsSection, createFieldsSectionv2 } from './resource/fields.js';
import { createMethodsSection } from './resource/methods.js';
import { createParamsSection } from './resource/parameters.js';
import { createExamplesSection } from './resource/examples.js';

export async function createResourceIndexContent(
    providerName,
    serviceName,
    resource,
) {
    // Generate each section of the documentation
    const overviewContent = createOverviewSection(resource.name, resource.type, resource.description, providerName, serviceName);
    const fieldsContent = createFieldsSection(resource.type, resource.resourceData, resource.dereferencedAPI);
    const methodsContent = resource.type === 'Resource' ? createMethodsSection(resource.resourceData, resource.dereferencedAPI) : '';
    const paramsContent = resource.type === 'Resource' ? createParamsSection(resource.resourceData, resource.dereferencedAPI) : '';
    const examplesContent = resource.type === 'Resource' ? createExamplesSection(providerName, serviceName, resource.name, resource.resourceData, resource.dereferencedAPI) : '';

    // Combine all sections into the final content
    return `${overviewContent}${fieldsContent}${methodsContent}${paramsContent}${examplesContent}`;
}

export async function createResourceIndexContentv2(
    providerName,
    serviceName,
    resource,
    succinct = false,
) {
    // Generate each section of the documentation (v2 uses SchemaTable for fields)
    const overviewContent = createOverviewSectionv2(resource.name, resource.type, resource.description, providerName, serviceName);
    const fieldsContent = createFieldsSectionv2(resource.type, resource.resourceData, resource.dereferencedAPI);
    const methodsContent = resource.type === 'Resource' ? createMethodsSection(resource.resourceData, resource.dereferencedAPI, succinct) : '';
    const paramsContent = resource.type === 'Resource' ? createParamsSection(resource.resourceData, resource.dereferencedAPI) : '';
    const examplesContent = resource.type === 'Resource' ? createExamplesSection(providerName, serviceName, resource.name, resource.resourceData, resource.dereferencedAPI, succinct) : '';

    // Combine all sections into the final content
    return `${overviewContent}${fieldsContent}${methodsContent}${paramsContent}${examplesContent}`;
}
