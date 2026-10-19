'use strict';
// Turns a title into a URL slug.
function slugify(input) {
  return input.trim().toLowerCase().replace(/[^a-z0-9]/g, '-');
}
module.exports = slugify;
