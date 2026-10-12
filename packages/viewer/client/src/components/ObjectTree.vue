<script setup lang="ts">
import ObjectTreeNode from './ObjectTreeNode.vue'

/**
 * Collapsible tree of a JSON-like value (parsed JSON, YAML, TOML, JSONL rows, inputs and outputs of cases).
 */
const props = withDefaults(defineProps<{ expandDepth?: number, value: unknown }>(), { expandDepth: 2 })
</script>

<template>
  <div :class="['font-mono text-xs leading-5']" role="tree" data-testid="object-tree">
    <ObjectTreeNode :value="props.value" :depth="0" :expand-depth="props.expandDepth" />
  </div>
</template>
