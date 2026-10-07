/* Tailwind runs for the Agent app's stylesheet (whirl/globals.css). The rest
   of Slates is plain CSS with no Tailwind directives, which the plugin
   leaves as it is. */
const config = {
  plugins: { "@tailwindcss/postcss": {} },
};

export default config;
