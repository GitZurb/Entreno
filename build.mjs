// Cadena de construcción única para las dos fases.
//
//   npm run build   → dist/panel.js   módulo ES autocontenido (fase 2, panel_custom)
//                   → dist/index.html página autónoma con el módulo incrustado (fase 1, artifact)
//   npm run dev     → lo mismo, reconstruyendo al guardar
//
// No hay dependencias de CDN en tiempo de ejecución: React, recharts y lucide-react
// van dentro del bundle.
import * as esbuild from "esbuild";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const watch = process.argv.includes("--watch");
const version = JSON.parse(readFileSync("package.json", "utf8")).version;

const options = {
  entryPoints: ["src/App.jsx"],
  bundle: true,
  minify: true,
  format: "esm",
  target: ["es2020"],
  jsx: "automatic",
  outfile: "dist/panel.js",
  legalComments: "none",
  define: {
    "process.env.NODE_ENV": '"production"',
    __APP_VERSION__: JSON.stringify(version),
  },
  logLevel: "info",
};

const htmlPlugin = {
  name: "standalone-html",
  setup(build) {
    build.onEnd((result) => {
      if (result.errors.length) return;
      mkdirSync("dist", { recursive: true });
      const js = readFileSync("dist/panel.js", "utf8").replace(/<\/script/gi, "<\\/script");
      const html = `<title>Entreno</title>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>html,body{margin:0;background:#0B0D10;color:#F2F4F7}</style>
<entreno-panel id="root"></entreno-panel>
<script type="module">${js}</script>
`;
      writeFileSync("dist/index.html", html);
      console.log(`dist/index.html escrito (${(html.length / 1024).toFixed(0)} kB)`);
    });
  },
};

if (watch) {
  const ctx = await esbuild.context({ ...options, plugins: [htmlPlugin] });
  await ctx.watch();
  console.log("Observando cambios en src/…");
} else {
  await esbuild.build({ ...options, plugins: [htmlPlugin] });
}
