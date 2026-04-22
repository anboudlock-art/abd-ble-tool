import { PrismaClient, DeviceCategory, DeviceScene, UserRole, Industry } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding device models...');
  await prisma.deviceModel.upsert({
    where: { code: 'GPS-LOGI-01' },
    update: {},
    create: {
      code: 'GPS-LOGI-01',
      name: 'GPS 物流锁',
      category: DeviceCategory.gps_lock,
      scene: DeviceScene.logistics,
      hasBle: true,
      has4g: true,
      hasGps: true,
      hasLora: false,
    },
  });
  await prisma.deviceModel.upsert({
    where: { code: 'ESEAL-LOGI-01' },
    update: {},
    create: {
      code: 'ESEAL-LOGI-01',
      name: '电子铅封',
      category: DeviceCategory.eseal,
      scene: DeviceScene.logistics,
      hasBle: true,
      has4g: false,
      hasGps: false,
      hasLora: false,
    },
  });
  await prisma.deviceModel.upsert({
    where: { code: '4GSEAL-LOGI-01' },
    update: {},
    create: {
      code: '4GSEAL-LOGI-01',
      name: '4G 铅封',
      category: DeviceCategory.fourg_eseal,
      scene: DeviceScene.logistics,
      hasBle: true,
      has4g: true,
      hasGps: false,
      hasLora: false,
    },
  });
  await prisma.deviceModel.upsert({
    where: { code: '4GPAD-SEC-01' },
    update: {},
    create: {
      code: '4GPAD-SEC-01',
      name: '4G 挂锁',
      category: DeviceCategory.fourg_padlock,
      scene: DeviceScene.security,
      hasBle: true,
      has4g: true,
      hasGps: false,
      hasLora: true,
    },
  });

  console.log('Seeding vendor admin user...');
  await prisma.user.upsert({
    where: { phone: '13800000000' },
    update: {},
    create: {
      phone: '13800000000',
      name: 'Vendor Admin',
      role: UserRole.vendor_admin,
    },
  });

  console.log('Seeding demo company...');
  await prisma.company.upsert({
    where: { shortCode: 'demo' },
    update: {},
    create: {
      name: '演示公司',
      shortCode: 'demo',
      industry: Industry.security,
    },
  });

  console.log('Seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
