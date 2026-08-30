// src/docgen/resource/examples.js

import { createSelectExamples } from './examples/select-example.js';
import { createInsertExamples } from './examples/insert-example.js';
import { createUpdateExamples } from './examples/update-example.js';
import { createDeleteExamples } from './examples/delete-example.js';
import { createExecExamples } from './examples/exec-example.js';

export function createExamplesSection(providerName, serviceName, resourceName, resourceData, dereferencedAPI, succinct = false, casing = null) {
    let content = '';

    // Add SELECT examples
    content += createSelectExamples(providerName, serviceName, resourceName, resourceData, dereferencedAPI, succinct, casing);

    // Add INSERT examples
    content += createInsertExamples(providerName, serviceName, resourceName, resourceData, dereferencedAPI, succinct, casing);

    // Add UPDATE examples
    content += createUpdateExamples(providerName, serviceName, resourceName, resourceData, dereferencedAPI, false, succinct, casing);

    // Add REPLACE examples
    content += createUpdateExamples(providerName, serviceName, resourceName, resourceData, dereferencedAPI, true, succinct, casing);

    // Add DELETE examples
    content += createDeleteExamples(providerName, serviceName, resourceName, resourceData, dereferencedAPI, succinct, casing);

    // Add EXEC examples
    content += createExecExamples(providerName, serviceName, resourceName, resourceData, dereferencedAPI, succinct, casing);

    return content;
}