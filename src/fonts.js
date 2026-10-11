// The app's typefaces, bundled with the app instead of loaded from Google
// Fonts. Three reasons:
//   • privacy — a Google Fonts <link> sends every visitor's IP address to
//     Google, which German courts have held to breach the GDPR without consent
//     (LG München I, 3 O 17493/20, 2022). Self-hosted, nothing leaves the site.
//   • the phone app works offline — at a game store with no signal the text
//     no longer falls back to a system font.
//   • one fewer outside dependency that can be slow or blocked.
//
// Same families and weights the old Google Fonts URL asked for. Each import
// is one weight; its CSS carries unicode-range subsets, so a browser only
// downloads the character sets a page actually uses (latin + latin-ext
// covers Czech). All four are SIL Open Font License.
import "@fontsource/cinzel/500.css";
import "@fontsource/cinzel/600.css";
import "@fontsource/cinzel/700.css";
import "@fontsource/spectral/400.css";
import "@fontsource/spectral/500.css";
import "@fontsource/spectral/600.css";
import "@fontsource/archivo/400.css";
import "@fontsource/archivo/500.css";
import "@fontsource/archivo/600.css";
import "@fontsource/archivo/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
