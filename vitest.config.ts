import {defineConfig} from "vitest/config";
import path from "path";


export default defineConfig({
    test: {
        globals: true
    },
    resolve: {
        alias:{
            "@/lib": path.resolve(import.meta.dirname, "lib"),
            "@/generated": path.resolve(import.meta.dirname, "generated"),
            "@": path.resolve(import.meta.dirname, "src"),
        }
    }
})