import DOMPurify from "dompurify";

// OPDS feeds and enrichment sources sometimes return HTML in summaries
// (<b>, <i>, <br>, entities). Sanitize down to basic inline formatting so
// feed-supplied markup can't inject anything beyond text styling.
const SANITIZE_OPTS = {
  ALLOWED_TAGS: ["b", "strong", "i", "em", "u", "br", "p", "ul", "ol", "li"],
  ALLOWED_ATTR: [] as string[],
};

// Some feeds double-escape HTML (e.g. CDATA-wrapped "weren&amp;#39;t"), which
// survives one decode and shows the entity literally. Collapse "&amp;" back to
// "&" only when it prefixes something entity-shaped, so real text like "AT&T"
// written as "AT&amp;T" is left alone.
function fixDoubleEscapes(html: string): string {
  return html.replace(/&amp;(#\d+|#x[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]{1,30});/g, "&$1;");
}

export function BookDescription({
  html,
  className,
}: {
  html: string;
  className?: string;
}) {
  return (
    <div
      className={className}
      dangerouslySetInnerHTML={{
        __html: DOMPurify.sanitize(fixDoubleEscapes(html), SANITIZE_OPTS),
      }}
    />
  );
}
