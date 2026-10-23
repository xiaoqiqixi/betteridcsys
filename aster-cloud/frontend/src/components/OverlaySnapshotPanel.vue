<script setup lang="ts">
import { RouterLink } from "vue-router";
import type { OverlaySnapshot, OverlayVPC } from "../api/overlay";
import { useConsole } from "../context";
import StatusBadge from "./StatusBadge.vue";
const props = defineProps<{ snapshot: OverlaySnapshot; vpcs?: OverlayVPC[] }>();
const {
  prefs: { tr },
} = useConsole();
const name = (id: string) =>
  props.vpcs?.find((v) => v.id === id)?.name ||
  props.snapshot.vpcs.find((v) => v.id === id)?.cidr ||
  id;
</script>
<template>
  <div class="snapshot-panel">
    <section>
      <h2>{{ tr("实例成员", "Instance members") }}</h2>
      <p v-if="!snapshot.members.length" class="empty-line">
        {{
          tr("此版本没有实例成员。", "This version has no instance members.")
        }}
      </p>
      <div v-else class="snapshot-rows">
        <article
          v-for="member in snapshot.members"
          :key="member.instance_id"
          class="snapshot-row"
        >
          <div>
            <RouterLink :to="`/instances/${member.instance_id}`">{{
              member.ipv4
            }}</RouterLink
            ><span>{{ member.node_id }} · {{ name(member.vpc_id) }}</span
            ><code>{{ member.instance_id }}</code
            ><span v-if="member.reserved">{{
              tr("预留成员", "Reserved member")
            }}</span>
          </div>
          <StatusBadge :state="member.enabled ? 'enabled' : 'disabled'" />
        </article>
      </div>
    </section>
    <section>
      <h2>{{ tr("路由", "Routes") }}</h2>
      <p v-if="!snapshot.gateways.length" class="empty-line">
        {{ tr("未设置跨网段路由。", "No inter-subnet routes configured.") }}
      </p>
      <article
        v-for="gateway in snapshot.gateways"
        :key="gateway.vpc_id"
        class="route-row"
      >
        <div>
          <strong>{{ name(gateway.vpc_id) }}</strong
          ><span
            >{{ tr("下一跳", "Next hop") }} {{ gateway.ipv4 }} ·
            {{ gateway.node_id }}</span
          >
        </div>
        <ul class="prefix-list">
          <li v-for="prefix in gateway.allowed_prefixes" :key="prefix">
            {{ prefix }}
          </li>
        </ul>
      </article>
    </section>
    <section>
      <h2>{{ tr("NAT 与端口转发", "NAT & port forwarding") }}</h2>
      <p v-if="!snapshot.nat_policies?.length" class="empty-line">
        {{ tr("此版本未启用 NAT。", "NAT is not enabled in this version.") }}
      </p>
      <article
        v-for="policy in snapshot.nat_policies"
        :key="policy.id"
        class="nat-summary"
      >
        <header>
          <div>
            <strong>{{ name(policy.vpc_id) }}</strong
            ><span>{{ policy.node_id }} · {{ policy.profile_id }}</span>
          </div>
          <StatusBadge
            :state="policy.snat_enabled ? 'enabled' : 'disabled'"
          /><span class="sr-only">SNAT</span>
        </header>
        <p class="field-note">
          {{
            policy.snat_enabled
              ? tr("出站地址转换已选择", "Outbound translation selected")
              : tr("出站地址转换关闭", "Outbound translation off")
          }}
        </p>
        <div
          v-for="rule in policy.forwardings"
          :key="rule.id"
          class="forward-summary"
        >
          <strong
            >{{ rule.protocol.toUpperCase() }} {{ rule.public_port }} →
            {{ rule.target_port }}</strong
          ><RouterLink :to="`/instances/${rule.target_instance_id}`">{{
            snapshot.members.find(
              (m) => m.instance_id === rule.target_instance_id,
            )?.ipv4 || rule.target_instance_id
          }}</RouterLink
          ><span
            >{{ tr("允许来源", "Allowed source") }} {{ rule.source_cidr }}</span
          >
        </div>
      </article>
    </section>
  </div>
</template>
<style scoped>
.snapshot-panel {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 28px;
}
.snapshot-panel > section {
  min-width: 0;
}
.snapshot-panel > section:first-child {
  grid-column: 1/-1;
}
.snapshot-panel h2 {
  font-size: 17px;
  margin: 0 0 16px;
}
.empty-line {
  font-size: 13px;
  line-height: 1.7;
  color: var(--secondary);
  padding: 18px;
  border: 1px dashed var(--border);
  border-radius: 10px;
  margin: 0;
}
.snapshot-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding: 16px 0;
  border-bottom: 1px solid var(--border);
}
.snapshot-row > div {
  display: grid;
  gap: 7px;
  min-width: 0;
}
.snapshot-row a {
  font-size: 14px;
  font-weight: 600;
}
.snapshot-row span,
.snapshot-row code,
.route-row span,
.nat-summary header span {
  font-size: 12px;
  color: var(--secondary);
  overflow-wrap: anywhere;
}
.route-row,
.nat-summary {
  padding: 18px;
  border: 1px solid var(--border);
  border-radius: 12px;
  margin-top: 12px;
}
.route-row > div,
.nat-summary header > div {
  display: grid;
  gap: 8px;
  min-width: 0;
}
.route-row strong,
.nat-summary strong {
  font-size: 14px;
  overflow-wrap: anywhere;
}
.prefix-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  list-style: none;
  padding: 0;
  margin: 16px 0 0;
}
.prefix-list li {
  font-size: 12px;
  background: var(--subtle);
  padding: 7px 10px;
  border-radius: 6px;
  overflow-wrap: anywhere;
}
.nat-summary header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}
.forward-summary {
  display: grid;
  gap: 8px;
  border-top: 1px solid var(--border);
  padding-top: 14px;
  margin-top: 14px;
  font-size: 13px;
}
.forward-summary span {
  font-size: 12px;
  color: var(--secondary);
}
.forward-summary a {
  overflow-wrap: anywhere;
}
@media (max-width: 700px) {
  .snapshot-panel {
    grid-template-columns: 1fr;
  }
  .snapshot-row {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
