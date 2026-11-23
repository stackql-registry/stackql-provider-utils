// src/docgen/resource/overview.js
import { 
    getIndefiniteArticle, 
    metaDescription,
    yamlString,
} from '../helpers.js';

// The page's meta description: the resource description's first sentence
// when there is one, the provider-wide line otherwise.
function resourcePageDescription(resourceDescription, providerName) {
  return yamlString(metaDescription(resourceDescription, `Query, deploy and manage ${providerName} resources using SQL`));
}

export function createOverviewSection(resourceName, resourceType, resourceDescription, providerName, serviceName) {

  let content = `--- 
title: ${resourceName}
hide_title: false
hide_table_of_contents: false
keywords:
  - ${resourceName}
  - ${serviceName}
  - ${providerName}
  - infrastructure-as-code
  - configuration-as-data
  - cloud inventory
description: ${resourcePageDescription(resourceDescription, providerName)}
custom_edit_url: null
image: /img/stackql-${providerName}-provider-featured-image.png
---

import CopyableCode from '@site/src/components/CopyableCode/CopyableCode';
import CodeBlock from '@theme/CodeBlock';
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

`;

content += resourceDescription ? resourceDescription : `Creates, updates, deletes, gets or lists ${getIndefiniteArticle(resourceName)} <code>${resourceName}</code> resource.`;

content += `

## Overview
<table><tbody>
<tr><td><b>Name</b></td><td><CopyableCode code="${resourceName}" /></td></tr>
<tr><td><b>Type</b></td><td>${resourceType}</td></tr>
<tr><td><b>Id</b></td><td><CopyableCode code="${providerName}.${serviceName}.${resourceName}" /></td></tr>
</tbody></table>

`;
    return content;
}

export function createOverviewSectionv2(resourceName, resourceType, resourceDescription, providerName, serviceName) {

  let content = `---
title: ${resourceName}
hide_title: false
hide_table_of_contents: false
keywords:
  - ${resourceName}
  - ${serviceName}
  - ${providerName}
  - infrastructure-as-code
  - configuration-as-data
  - cloud inventory
description: ${resourcePageDescription(resourceDescription, providerName)}
custom_edit_url: null
image: /img/stackql-${providerName}-provider-featured-image.png
---

import CopyableCode from '@site/src/components/CopyableCode/CopyableCode';
import CodeBlock from '@theme/CodeBlock';
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';
import SchemaTable from '@site/src/components/SchemaTable/SchemaTable';

`;

content += resourceDescription ? resourceDescription : `Creates, updates, deletes, gets or lists ${getIndefiniteArticle(resourceName)} <code>${resourceName}</code> resource.`;

content += `

## Overview
<table><tbody>
<tr><td><b>Name</b></td><td><CopyableCode code="${resourceName}" /></td></tr>
<tr><td><b>Type</b></td><td>${resourceType}</td></tr>
<tr><td><b>Id</b></td><td><CopyableCode code="${providerName}.${serviceName}.${resourceName}" /></td></tr>
</tbody></table>

`;
    return content;
}
