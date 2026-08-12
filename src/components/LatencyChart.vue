<script setup lang="ts">
import { Chart } from "chart.js/auto";
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { ServiceStat } from "../parser";

const props = defineProps<{ services: ServiceStat[] }>();
const canvas = ref<HTMLCanvasElement | null>(null);
let chart: Chart | null = null;

function renderChart() {
  chart?.destroy();
  if (!canvas.value) return;
  chart = new Chart(canvas.value, {
    type: "bar",
    data: {
      labels: props.services.map((service) => service.service),
      datasets: [
        {
          label: "Observed p95 (ms)",
          data: props.services.map((service) => service.p95),
          backgroundColor: props.services.map((service) =>
            service.errors > 0 ? "#eb755f" : "#68c4b8",
          ),
          borderRadius: 5,
          borderSkipped: false,
          barThickness: 18,
        },
      ],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      animation: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? false
        : { duration: 360 },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: { label: (item) => Number(item.raw) + " ms p95" },
        },
      },
      scales: {
        x: {
          beginAtZero: true,
          grid: { color: "#303538" },
          ticks: { color: "#8d9698", callback: (value) => value + " ms" },
        },
        y: {
          grid: { display: false },
          ticks: { color: "#d7ddde", font: { family: "ui-monospace" } },
        },
      },
    },
  });
}

onMounted(renderChart);
watch(() => props.services, renderChart, { deep: true });
onBeforeUnmount(() => chart?.destroy());
</script>

<template>
  <div class="latency-chart">
    <canvas
      ref="canvas"
      role="img"
      aria-label="Observed p95 latency by service"
    ></canvas>
  </div>
</template>

<style scoped>
.latency-chart {
  height: 245px;
}
</style>
