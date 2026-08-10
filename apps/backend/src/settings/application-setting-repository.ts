import type { EditableApplicationSettingName } from "@brickr/shared";
import type { Db } from "../persistence/prisma.js";

export class ApplicationSettingRepository {
  constructor(private readonly db: Db) {}

  async findAll(): Promise<Map<EditableApplicationSettingName, string>> {
    const rows = await this.db.applicationSetting.findMany();
    return new Map(
      rows.map((row) => [row.key as EditableApplicationSettingName, row.value]),
    );
  }

  async save(
    values: Partial<Record<EditableApplicationSettingName, string | null>>,
  ): Promise<void> {
    await this.db.$transaction(
      Object.entries(values).map(([key, value]) =>
        value === null
          ? this.db.applicationSetting.deleteMany({ where: { key } })
          : this.db.applicationSetting.upsert({
              where: { key },
              create: { key, value },
              update: { value },
            }),
      ),
    );
  }
}
