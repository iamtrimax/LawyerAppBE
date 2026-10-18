const pick = (value, fields) => {
    if (!value || typeof value !== 'object') return value == null ? null : undefined;
    const result = {};
    for (const key of fields) if (value[key] !== undefined) result[key] = value[key];
    return result;
};
const publicUser = value => pick(value, ['_id', 'fullname', 'avatar']);
const publicAuthor = value => {
    const result = pick(value, ['_id', 'avatar', 'name']);
    if (!result) return value == null ? null : undefined;
    if (value.userID) result.userID = publicUser(value.userID);
    return result;
};
const publicAttachments = value => Array.isArray(value) ? value.map(item => pick(item, ['name', 'url'])) : [];
const lawyerFields = ['_id', 'slug', 'avatar', 'lawyerId', 'specialty', 'firmName', 'yearsOfExperience', 'titleDegree', 'operatingProvinces', 'introduction', 'isApproved'];
const publicLawyer = value => {
    const result = pick(value, lawyerFields);
    if (!result) return null;
    if (value.userID) result.userID = publicUser(value.userID);
    return result;
};
const publicLawyerListItem = value => pick(value, [...lawyerFields, 'profileId', 'fullname']);
const publicArticle = value => {
    const result = pick(value, ['_id', 'slug', 'title', 'content', 'category', 'tags', 'images', 'thumbnail', 'sourceUrl', 'publishedDate', 'createdAt', 'updatedAt', 'views', 'downloadCount']);
    if (!result) return null;
    if (value.author) result.author = publicAuthor(value.author);
    if (value.attachments) result.attachments = publicAttachments(value.attachments);
    return result;
};
const publicForm = value => {
    const result = pick(value, ['_id', 'slug', 'name', 'description', 'category', 'fileUrl', 'fileType', 'thumbnail', 'downloadCount', 'isFree', 'createdAt', 'updatedAt']);
    if (!result) return null;
    if (value.lawyerID) result.lawyerID = publicAuthor(value.lawyerID);
    return result;
};
const publicResource = value => {
    const result = pick(value, ['_id', 'slug', 'title', 'description', 'content', 'category', 'language', 'thumbnail', 'sourceUrl', 'publishedDate', 'createdAt', 'updatedAt', 'views']);
    if (!result) return null;
    if (value.attachments) result.attachments = publicAttachments(value.attachments);
    return result;
};
const pagination = value => pick(value, ['total', 'page', 'limit', 'totalPages']);
const map = (items, serializer) => Array.isArray(items) ? items.map(serializer).filter(Boolean) : [];

function publicPayload(type, body) {
    switch (type) {
        case 'lawyer': return publicLawyer(body.data);
        case 'lawyerSearch': return map(body.data, publicLawyer);
        case 'lawyers': return map(body.data, publicLawyerListItem);
        case 'article': return publicArticle(body.data);
        case 'articles': return { ...pick(body.data, ['total', 'page', 'totalPages']), articles: map(body.data?.articles, publicArticle) };
        case 'form': return publicForm(body.data);
        case 'forms': return { items: map(body.data, publicForm), pagination: pagination(body.pagination) };
        case 'formSearch': return map(body.data, publicForm);
        case 'resource': return publicResource(body.data);
        case 'resources': return { items: map(body.data, publicResource), pagination: pagination(body.pagination) };
        case 'resourceSearch': return map(body.data, publicResource);
        case 'articleSearch': return { answer: body.data?.answer || '', sources: map(body.data?.sources, value => pick(value, ['_id', 'title', 'url', 'content', 'category'])) };
        default: throw new Error(`Unknown public response type: ${type}`);
    }
}
module.exports = { publicPayload };
