// Inventory (the add-on): stock kept in FunnelHive — built out in phase 2. Industry tools (phase 3) render inside it.
import { Layout, Empty } from '../ui';
import IndustryTools from './InventoryPro';

export default function Inventory() {
  return (
    <Layout title="Inventory" sub="Your stock, in FunnelHive">
      <Empty icon="box" title="Inventory is on its way" text="Items, godowns and stock in and out will show here." />
      <IndustryTools />
    </Layout>
  );
}
