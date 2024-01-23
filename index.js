#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const prettier = require('prettier');

const axios = require('axios');

const args = process.argv.slice(2);
const config = {
  component: null,
  url: 'http://localhost:1337',
  dir: '',
};

/**
 * Format code
 *
 * @param code - The code to format
 * @param parser - The parser to use
 * 
 * @returns The formatted code
 */
async function formatCode(code, parser) {
  const options = {
    semi: true,
    parser,
    singleQuote: false,
    bracketSpacing: true,
    arrowParens: 'avoid',
    vueIndentScriptAndStyle: true,
    bracketSameLine: true,
  }

  return await prettier.format(code, options);
}

/**
 * Process a string to create a name and collection
 *
 * @param str - The string to process
 *
 * @returns {Object} An object containing the name and collection
 */
function processString(str) {
  // Split the string by dots and hyphens, and capitalize each segment
  const capitalizedSegments = str.split(/[-.]/).map(segment =>
      segment.charAt(0).toUpperCase() + segment.slice(1)
  );

  const nameSegments = str.split('.')[1].split('-').map(segment =>
      segment.charAt(0).toUpperCase() + segment.slice(1)
  );

  // Join the segments back together for the name
  const name = nameSegments.join('');

  // Create the collection name by joining the segments with a specific format
  const collection = `Component${capitalizedSegments.join('')}`;

  return {
    name: name,
    collection: collection
  };
}

/**
 * Fetch the fields for a component
 *
 * @param url - The URL of the Strapi instance
 * @param component - The component to fetch the fields for
 *
 * @returns Component fragment
 */
async function fetchComponentFields(url, component) {
  try {
    const response = await axios.get(`${url}/api/content-type-builder/components/${component}`);
    const attributes = response.data.data.schema.attributes;
    return parseFields(attributes);
  } catch (error) {
    console.error(`Error fetching component ${component}:`, error);
    return null;
  }
};

/**
 * Parse the fields of a component
 *
 * @param attributes - The attributes of the component
 *
 * @returns Component fragment
 */
async function parseFields(attributes) {
  const fieldPromises = Object.keys(attributes).map(async (field) => {
    switch (attributes[field].type) {
      case 'media':
        return `${field} {\n      data {\n        attributes {\n          url\n        }\n      }\n    }`;
      case 'component':
        const componentFields = await fetchComponentFields(config.url, attributes[field].component);
        return `${field} {\n      ${componentFields.join('\n      ')}\n    }`;
      default:
        return field;
    }
  });

  return Promise.all(fieldPromises);
};

(async () => {
  try {
    for (let i = 0; i < args.length; i++) {
      switch (args[i]) {
        case '-i':
        case '--component':
          config.component = args[i + 1];
          break;
        case '--url':
          config.url = args[i + 1];
          break;
        case '--dir':
          config.dir = args[i + 1];
          break;
      }
    }

  config.sectionsDir = path.join(process.cwd(), config.dir, 'components', 'sections');
  config.sectionsFragmentsDir = path.join(process.cwd(), config.dir, 'graphql', 'fragments', 'sections');
  config.sectionsFragmentsIndexDir = path.join(process.cwd(), config.dir, 'graphql', 'fragments', 'index.ts');

  if (!fs.existsSync(config.sectionsDir)) {
    fs.mkdirSync(config.sectionsDir, { recursive: true });
  }

  if (!fs.existsSync(config.sectionsFragmentsDir)) {
    fs.mkdirSync(config.sectionsFragmentsDir, { recursive: true });
  }

  const attributes = await fetchComponentFields(config.url, config.component);

  const { name, collection } = processString(config.component);

  // Create code for the files.
  const gqlFragment = `
    import { gql } from 'graphql-tag';

    export const ${name} = gql\`
      fragment ${name} on ${collection} {
        ${attributes.join('\n    ')}
      }
  \`;`;

  const componentCode = `
    <template>
      <div>
        {{ data }}
      </div>
    </template>

    <script setup lang="ts">
      import type { ${name} } from './${name.charAt(0).toLowerCase() + name.slice(1)}.types.ts';

      defineProps({
        data: {
          type: Object as PropType<${name}>,
          required: true,
        },
      });
    </script>
  `;

  const componentTypesCode = `
    /**
     * ${name} section types.
     */
    export interface ${name} {
    }
  `;

  const indexCode = `export { ${name} } from './sections/${name.charAt(0).toLowerCase() + name.slice(1)}';\n`;

  // Format the code.
  const fragmentCode = await formatCode(gqlFragment, "typescript");
  const formattedComponentCode = await formatCode(componentCode, "vue");
  const formattedComponentTypesCode = await formatCode(componentTypesCode, "typescript");

  // Create files paths.
  const fragmentFilePath = path.join(config.sectionsFragmentsDir, `${name.charAt(0).toLowerCase() + name.slice(1)}.ts`);
  const componentFilePath = path.join(config.sectionsDir, `${name}.vue`);
  const componentTypesFilePath = path.join(config.sectionsDir, `${name.charAt(0).toLowerCase() + name.slice(1)}.types.ts`);

  // Create files.
  if (!fs.existsSync(fragmentFilePath)) {
    fs.appendFileSync(fragmentFilePath, fragmentCode, { encoding: 'utf8' });
  }

  if (!fs.existsSync(componentFilePath)) {
    fs.appendFileSync(componentFilePath, formattedComponentCode, { encoding: 'utf8' });
  }

  if (!fs.existsSync(componentTypesFilePath)) {
    fs.appendFileSync(componentTypesFilePath, formattedComponentTypesCode, { encoding: 'utf8' });
  }

  const isIndexFile = fs.existsSync(config.sectionsFragmentsIndexDir);

  if (isIndexFile) {
    const indexFileContent = fs.readFileSync(config.sectionsFragmentsIndexDir, { encoding: 'utf8' });

    if (indexFileContent.includes(indexCode)) {
      return;
    }
  }

  fs.appendFileSync(config.sectionsFragmentsIndexDir, indexCode, { encoding: 'utf8' });
  } catch (error) {
    console.error(error);
  }
})();
