const generateLegalFormSlug = (name = '', id, fallback = 'bieu-mau') => {
    const title = String(name).normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[\u0111\u0110]/g, 'd')
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '')
        .substring(0, 100)
        .replace(/-+$/g, '');
    // Keep duplicate names unique without a lookup or a creation race.
    return `${title || fallback}-${id}`;
};

const withLegalFormSlug = (form) => form && ({
    ...form,
    slug: form.slug || generateLegalFormSlug(form.name, form._id),
});

module.exports = { generateLegalFormSlug, withLegalFormSlug };
