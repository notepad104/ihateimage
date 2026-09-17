/**
 * Search-facing copy for every page: titles, descriptions, how-to steps and
 * FAQs. Used by the client (document head, guide sections) and by the
 * build-time prerenderer (static HTML, JSON-LD, sitemap).
 */
import { TOOLS } from './tools'

/** Absolute site origin for canonical URLs, sitemap and Open Graph. Set VITE_SITE_URL at build time. */
export const SITE_URL = (import.meta.env.VITE_SITE_URL as string | undefined)?.replace(/\/+$/, '') || 'https://ihateimage.app'
export const SITE_NAME = 'ihateimage'

export interface Faq {
  q: string
  a: string
}

export interface PageSeo {
  path: string
  /** ≤ 60 characters ideally */
  title: string
  /** ≤ 155 characters ideally */
  description: string
  h1: string
  intro: string
  steps: string[]
  faqs: Faq[]
  /** Tool ids to cross-link */
  related: string[]
  toolId?: string
}

const PRIVACY_FAQ: Faq = {
  q: 'Are my images uploaded anywhere?',
  a: 'No. Every tool runs inside your browser using Web Workers and WebAssembly. Files never leave your device, and there is no server, account or tracking.',
}

export const HOME_SEO: PageSeo = {
  path: '/',
  title: 'Free Online Image Tools, No Upload — ihateimage',
  description:
    'Compress, resize, crop, convert, watermark and clean up photos 100% in your browser. Free image editor with no uploads, no sign-up and no tracking.',
  h1: 'Every tool you need to work with images, without giving them away',
  intro:
    'ihateimage is a free online image editor that never uploads your files. Compress and resize photos, crop to any aspect ratio, convert between JPG, PNG, WebP and AVIF, remove backgrounds and objects, add watermarks and strip GPS metadata, all on your own device.',
  steps: ['Pick a tool', 'Drop your images, even hundreds at once', 'Adjust the settings with a live preview', 'Download the results or a ZIP'],
  faqs: [
    PRIVACY_FAQ,
    {
      q: 'Is ihateimage really free?',
      a: 'Yes. There are no limits on file count or size beyond what your browser can handle, and no premium tier.',
    },
    {
      q: 'Which image formats are supported?',
      a: 'JPG, PNG, WebP, GIF and BMP as input everywhere, plus AVIF where your browser supports it. Output can be JPG, PNG, WebP or AVIF.',
    },
    {
      q: 'Does it work offline?',
      a: 'After the first visit the app itself works offline. The two AI tools download their models once and keep them cached in your browser.',
    },
  ],
  related: TOOLS.map((t) => t.id),
}

export const TOOL_SEO: Record<string, PageSeo> = {
  compress: {
    path: '/compress',
    toolId: 'compress',
    title: 'Compress Images Online Free, No Upload — ihateimage',
    description:
      'Reduce JPG, PNG and WebP file size in your browser. Pick a quality or a target size like 500 KB, compress hundreds of photos at once, nothing is uploaded.',
    h1: 'Compress image',
    intro:
      'Shrink photos for email, websites and messaging without losing visible quality. Choose a quality level or a maximum file size and the encoder finds the best setting automatically.',
    steps: ['Drop one or many images', 'Choose a quality, or a target size such as 200 KB', 'Optionally limit the longest side to downscale huge photos', 'Download the compressed files or a ZIP'],
    faqs: [
      PRIVACY_FAQ,
      { q: 'How much smaller will my image get?', a: 'Typically 60–80% smaller for camera JPGs at quality 80, with no visible difference. Converting to WebP saves another 25–35%.' },
      { q: 'Can I compress to an exact file size?', a: 'Yes. Switch to “Target size”, enter the size in KB, and the quality is searched automatically to land just under it.' },
      { q: 'Why did my PNG barely shrink?', a: 'PNG is lossless, so there is little to remove. Choose WebP or JPG as the output format for much smaller files.' },
    ],
    related: ['resize', 'convert', 'metadata'],
  },
  resize: {
    path: '/resize',
    toolId: 'resize',
    title: 'Resize Images Online in Bulk — ihateimage',
    description:
      'Resize photos by pixels or percentage, lock the aspect ratio, or fit inside a box. Batch resize in your browser with no upload and no quality loss from re-uploads.',
    h1: 'Resize image',
    intro:
      'Set an exact width or height, scale by percentage, or fit every image inside a maximum box. Proportions are kept automatically and small images are never enlarged unless you ask.',
    steps: ['Drop your images', 'Enter a width, a height, a percentage or a bounding box', 'Check the live size preview for the selected image', 'Download'],
    faqs: [
      PRIVACY_FAQ,
      { q: 'Will resizing reduce quality?', a: 'Downscaling uses stepped high-quality resampling, so results stay sharp. Enlarging always invents pixels and is off by default.' },
      { q: 'Can I resize many photos to the same width?', a: 'Yes. Enter the width, leave the height blank, and every image is scaled proportionally to that width.' },
    ],
    related: ['compress', 'aspect', 'convert'],
  },
  aspect: {
    path: '/aspect-ratio',
    toolId: 'aspect',
    title: 'Crop Images to Aspect Ratio (1:1, 16:9, 9:16) — ihateimage',
    description:
      'Crop photos to Instagram, Story, YouTube or print ratios with a draggable frame, or add borders so nothing is cut. Batch crop in your browser, no upload.',
    h1: 'Change aspect ratio',
    intro:
      'Turn any photo into a square, a 9:16 story, a 16:9 thumbnail or a 4:5 portrait. Crop with a draggable frame or pad with a color to keep the whole picture.',
    steps: ['Drop your images', 'Pick a ratio preset or type a custom one', 'Drag the frame, or choose an anchor for the whole batch', 'Download'],
    faqs: [
      PRIVACY_FAQ,
      { q: 'What ratio should I use for Instagram?', a: '1:1 for square posts, 4:5 for portrait posts and 9:16 for Stories and Reels. All three are presets.' },
      { q: 'Can I avoid cropping anything off?', a: 'Yes. Switch to “Add borders” and the image is padded with a color of your choice to reach the ratio.' },
    ],
    related: ['resize', 'rotate', 'watermark'],
  },
  convert: {
    path: '/convert',
    toolId: 'convert',
    title: 'Convert Images to JPG, PNG, WebP or AVIF — ihateimage',
    description:
      'Convert between JPG, PNG, WebP and AVIF in your browser. Batch convert photos with a quality slider and background color for transparency. No upload.',
    h1: 'Convert format',
    intro:
      'Switch formats in bulk. WebP and AVIF give the smallest files for the web, PNG keeps transparency and JPG works everywhere.',
    steps: ['Drop your images', 'Pick the target format and quality', 'Choose a background color if transparency is dropped', 'Download'],
    faqs: [
      PRIVACY_FAQ,
      { q: 'WebP or AVIF?', a: 'AVIF is smaller and supports HDR, but encodes slowly and is not supported by very old browsers. WebP is the safe default.' },
      { q: 'Can I convert HEIC photos from my iPhone?', a: 'Safari decodes HEIC natively, so it works there. Other browsers cannot open HEIC yet.' },
    ],
    related: ['compress', 'resize', 'metadata'],
  },
  rotate: {
    path: '/rotate',
    toolId: 'rotate',
    title: 'Rotate and Flip Images Online — ihateimage',
    description: 'Rotate photos by 90°, 180° or 270° and mirror them horizontally or vertically, in bulk, in your browser. No upload, no watermark.',
    h1: 'Rotate & flip',
    intro: 'Fix sideways photos and mirrored selfies in one click, for one image or a whole folder.',
    steps: ['Drop your images', 'Rotate left or right, flip horizontally or vertically', 'Check the preview', 'Download'],
    faqs: [PRIVACY_FAQ, { q: 'Does rotating a JPG lose quality?', a: 'The image is re-encoded once at high quality; the difference is invisible. Choose PNG output for a lossless result.' }],
    related: ['aspect', 'resize', 'beautify'],
  },
  'remove-bg': {
    path: '/remove-background',
    toolId: 'remove-bg',
    title: 'Remove Image Background Free, On-Device AI — ihateimage',
    description:
      'Remove the background from photos automatically with an AI model that runs in your browser. Transparent PNG or any color, no upload, no sign-up.',
    h1: 'Remove background',
    intro:
      'Cut out people, products and objects with a neural network that runs on your own device. Get a transparent PNG or drop in a solid color.',
    steps: ['Drop a photo (or several)', 'Choose transparent or a background color', 'Wait a few seconds while the model runs on your device', 'Download the cut-out'],
    faqs: [
      { q: 'Is the photo sent to a server for the AI?', a: 'No. The model is downloaded to your browser once (44 MB, or 88 MB for the Best model) and runs locally. Your photo stays on your device.' },
      { q: 'How good are the edges?', a: 'People, pets and products come out clean with the Fast model. Choose “Best” for hair and fine detail; it uses the full-precision network.' },
    ],
    related: ['remove-objects', 'beautify', 'convert'],
  },
  beautify: {
    path: '/beautify',
    toolId: 'beautify',
    title: 'Photo Editor: Filters, Color and Light Adjustments — ihateimage',
    description:
      'Fix exposure, white balance and color, apply one-tap looks, or change a specific color with the eyedropper. Free browser photo editor, nothing uploaded.',
    h1: 'Beautify image',
    intro:
      'Brightness, contrast, highlights, shadows, temperature, saturation, sharpening, vignette and film grain, plus one-tap looks and a recolor tool that swaps one hue for another while keeping shading.',
    steps: ['Drop your photos', 'Pick a look or move the sliders with a live preview', 'Use the eyedropper to recolor a specific object', 'Apply to every image and download'],
    faqs: [
      PRIVACY_FAQ,
      { q: 'Can I change the color of a shirt or a car?', a: 'Yes. Click “Pick a color to change”, click the object, then choose the new color. Shadows and texture are preserved.' },
      { q: 'Can I apply the same look to many photos?', a: 'Yes. Settings apply to every image in the batch when you press Apply.' },
    ],
    related: ['remove-objects', 'compress', 'watermark'],
  },
  'remove-objects': {
    path: '/remove-objects',
    toolId: 'remove-objects',
    title: 'Remove Objects and People from Photos — ihateimage',
    description:
      'Brush over unwanted people, text or blemishes and the background is rebuilt automatically with on-device AI. Free, private, no upload.',
    h1: 'Remove objects',
    intro:
      'Paint over anything you want gone. A content-aware fill rebuilds the background from the surroundings, with a fast pattern-matching mode or an on-device neural network for complex scenes.',
    steps: ['Drop a photo', 'Mark the object with the brush', 'Choose AI or Fast fill and press Remove', 'Repeat for other objects, then download'],
    faqs: [
      { q: 'Does the AI upload my photo?', a: 'No. The fill model (about 28 MB) is downloaded once and runs in your browser with WebGPU or WebAssembly.' },
      { q: 'What works best?', a: 'Mark generously, including shadows. Isolated objects on textured backgrounds like grass, sky, walls or water give the cleanest results.' },
    ],
    related: ['remove-bg', 'beautify', 'aspect'],
  },
  watermark: {
    path: '/watermark',
    toolId: 'watermark',
    title: 'Add Watermark to Photos in Bulk — ihateimage',
    description:
      'Add a text or logo watermark to many photos at once. Choose the position by dragging, set opacity and size, or tile it across the image. Runs in your browser.',
    h1: 'Add watermark',
    intro:
      'Protect and brand your images with text or a logo. Place it in a corner, drag it anywhere, or repeat it across the whole picture. The size is relative, so it looks identical on every photo.',
    steps: ['Drop your photos', 'Type the text or choose a logo, set size, opacity and rotation', 'Pick a corner, drag on the preview, or enable tiling', 'Download'],
    faqs: [
      PRIVACY_FAQ,
      { q: 'Can I use my own logo?', a: 'Yes. Choose “Logo” and pick a PNG; transparency is preserved. Set its width as a percentage of the photo.' },
      { q: 'Will the watermark be the same size on portrait and landscape photos?', a: 'Yes. Size and position are stored relative to each image, so the batch looks consistent.' },
    ],
    related: ['compress', 'resize', 'metadata'],
  },
  metadata: {
    path: '/metadata',
    toolId: 'metadata',
    title: 'View, Remove or Edit EXIF and GPS Data — ihateimage',
    description:
      'See what your photos reveal (location, camera, date), strip all metadata, or replace it with your own values. Lossless for JPG, PNG and WebP. No upload.',
    h1: 'Edit EXIF & GPS',
    intro:
      'Photos carry hidden data: GPS coordinates, camera model, dates, sometimes your name. Inspect it, delete it before sharing, or rewrite it. The image pixels are copied untouched.',
    steps: ['Drop your photos', 'Review the metadata for each image', 'Choose “Remove all” or edit the fields', 'Download the cleaned files'],
    faqs: [
      PRIVACY_FAQ,
      { q: 'Does removing EXIF change image quality?', a: 'No. Only metadata blocks are removed; the compressed pixel data is copied byte for byte.' },
      { q: 'Which formats can be edited losslessly?', a: 'JPG, PNG and WebP. Other formats are converted to JPG so the metadata can be written.' },
    ],
    related: ['compress', 'convert', 'watermark'],
  },
}

export const ALL_PAGES: PageSeo[] = [HOME_SEO, ...TOOLS.map((t) => TOOL_SEO[t.id]).filter(Boolean)]

export function seoForPath(pathname: string): PageSeo | null {
  const clean = pathname.replace(/\/+$/, '') || '/'
  return ALL_PAGES.find((p) => p.path === clean) ?? null
}

export function absoluteUrl(path: string): string {
  return path === '/' ? `${SITE_URL}/` : `${SITE_URL}${path}`
}

/** JSON-LD for a page: WebApplication on home, HowTo + FAQ + breadcrumbs on tools. */
export function structuredData(page: PageSeo): object[] {
  const url = absoluteUrl(page.path)
  const faq = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: page.faqs.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  }
  if (page.path === '/') {
    return [
      {
        '@context': 'https://schema.org',
        '@type': 'WebApplication',
        name: SITE_NAME,
        url,
        description: page.description,
        applicationCategory: 'MultimediaApplication',
        operatingSystem: 'Any',
        browserRequirements: 'Requires JavaScript and a modern browser',
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        featureList: TOOLS.map((t) => t.name),
      },
      faq,
    ]
  }
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Image tools', item: `${SITE_URL}/` },
        { '@type': 'ListItem', position: 2, name: page.h1, item: url },
      ],
    },
    {
      '@context': 'https://schema.org',
      '@type': 'HowTo',
      name: page.title.replace(/ — .*$/, ''),
      description: page.description,
      tool: { '@type': 'HowToTool', name: SITE_NAME },
      step: page.steps.map((s, i) => ({ '@type': 'HowToStep', position: i + 1, text: s })),
    },
    faq,
  ]
}
