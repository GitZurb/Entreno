// Cadena de construcción única para las dos fases.
//
//   npm run build   → dist/panel.js    módulo ES autocontenido (panel_custom / tarjeta)
//                   → dist/index.html  página autónoma con el módulo incrustado (artifact)
//                   → dist/resource.js mismo módulo comprimido y autoextraíble, para
//                                      registrarlo como recurso en línea de Lovelace
//                                      cuando no hay acceso a config/www
//   npm run dev     → lo mismo, reconstruyendo al guardar
//
// No hay dependencias de CDN en tiempo de ejecución: Preact, los iconos y las
// gráficas (SVG propio, sin librería) van dentro del bundle.
import * as esbuild from "esbuild";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { gzipSync } from "node:zlib";

const watch = process.argv.includes("--watch");
const version = JSON.parse(readFileSync("package.json", "utf8")).version;

const options = {
  entryPoints: ["src/App.jsx"],
  bundle: true,
  minify: true,
  format: "esm",
  target: ["es2021"],
  jsx: "automatic",
  jsxImportSource: "preact",
  outfile: "dist/panel.js",
  legalComments: "none",
  // Preact en lugar de React: mismo API a través de preact/compat y ~200 kB menos.
  alias: {
    react: "preact/compat",
    "react-dom": "preact/compat",
    "react-dom/client": "preact/compat/client",
  },
  define: {
    "process.env.NODE_ENV": '"production"',
    __APP_VERSION__: JSON.stringify(version),
  },
  logLevel: "info",
};

const kB = (n) => `${(n / 1024).toFixed(0)} kB`;

const emitPlugin = {
  name: "emit-targets",
  setup(build) {
    build.onEnd((result) => {
      if (result.errors.length) return;
      mkdirSync("dist", { recursive: true });
      const js = readFileSync("dist/panel.js", "utf8");

      // 1. Página autónoma
      const inline = js.replace(/<\/script/gi, "<\\/script");
      writeFileSync("dist/index.html", `<title>Entreno</title>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>html,body{margin:0;background:#0B0D10;color:#F2F4F7}</style>
<entreno-panel id="root"></entreno-panel>
<script type="module">${inline}</script>
`);

      // 2. Módulo autoextraíble para el recurso en línea de Lovelace.
      //    Un recurso en línea se guarda como data: URI y admite ~128 kB, así que
      //    el código va comprimido con gzip y se descomprime en el navegador con
      //    DecompressionStream antes de importarse como módulo.
      const b64 = gzipSync(Buffer.from(js, "utf8"), { level: 9 }).toString("base64");
      // Comprobación de integridad: si el payload llega truncado o alterado, el
      // panel lo dice en pantalla en lugar de quedarse en blanco.
      let sum = 0;
      for (let i = 0; i < js.length; i++) sum = (sum * 31 + js.charCodeAt(i)) >>> 0;
      const loader = `// Entreno v${version} · módulo comprimido (gzip+base64) para recurso en línea de Lovelace\n`
        + `const D="${b64}",N=${js.length},C=${sum};\n`
        + `const fail=(m)=>{if(!customElements.get("entreno-panel"))customElements.define("entreno-panel",class extends HTMLElement{setConfig(){}getCardSize(){return 3}connectedCallback(){this.style.cssText="display:block;padding:16px;border-radius:16px;background:var(--card-background-color,#15181D);color:var(--error-color,#FF5C5C);font-family:sans-serif";this.textContent="Entreno no se pudo cargar: "+m}});};\n`
        + `try{\n`
        + `const b=Uint8Array.from(atob(D),c=>c.charCodeAt(0));\n`
        + `const t=await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream("gzip"))).text();\n`
        + `let h=0;for(let i=0;i<t.length;i++)h=(h*31+t.charCodeAt(i))>>>0;\n`
        + `if(t.length!==N||h!==C)throw new Error("el codigo llego incompleto, vuelve a registrar el recurso");\n`
        + `const u=URL.createObjectURL(new Blob([t],{type:"text/javascript"}));\n`
        + `await import(u);URL.revokeObjectURL(u);\n`
        + `}catch(e){fail(e.message);}\n`;
      writeFileSync("dist/resource.js", loader);

      console.log(`dist/index.html   ${kB(inline.length)}`);
      console.log(`dist/resource.js  ${kB(loader.length)}  (límite del recurso en línea ~128 kB)`);
    });
  },
};

if (watch) {
  const ctx = await esbuild.context({ ...options, plugins: [emitPlugin] });
  await ctx.watch();
  console.log("Observando cambios en src/…");
} else {
  await esbuild.build({ ...options, plugins: [emitPlugin] });
}
