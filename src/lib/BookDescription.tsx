import DOMPurify from "dompurify";

// OPDS feeds and enrichment sources sometimes return HTML in summaries
// (<b>, <i>, <br>, entities). Sanitize down to basic inline formatting so
// feed-supplied markup can't inject anything beyond text styling.
const SANITIZE_OPTS = {
  ALLOWED_TAGS: ["b", "strong", "i", "em", "u", "br", "p", "ul", "ol", "li"],
  ALLOWED_ATTR: [] as string[],
};

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
      dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html, SANITIZE_OPTS) }}
    />
  );
}
