const { generateLegalFormSlug } = require('./legalFormSlug');
const generateLegalResourceSlug = (title, id) => generateLegalFormSlug(title, id, 'legal-resource');
const withLegalResourceSlug = resource => resource && ({
    ...resource,
    slug: resource.slug || generateLegalResourceSlug(resource.title, resource._id),
});
module.exports = { generateLegalResourceSlug, withLegalResourceSlug };
