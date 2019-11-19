import { startOfDay, endOfDay, parseISO } from 'date-fns';
import { Op } from 'sequelize';

import Appointment from '../models/Appointment';
import User from '../models/User';

class ScheduleController {
  async index(req, res) {
    const notProvider = await User.findOne({
      where: { id: req.userId, provider: true },
    });

    if (notProvider) {
      return res.status(401).json({
        error: 'Não é um barbeiro',
      });
    }

    const { date } = req.query;
    const parsedDate = parseISO(date);

    const appointments = await Appointment.findAll({
      where: {
        id: req.userId,
        canceled_at: null,
        date: {
          [Op.between]: [startOfDay(parsedDate), endOfDay(parsedDate)],
        },
        include: [
          {
            model: User,
            as: 'user',
            attribute: ['name'],
          },
        ],
        order: ['date'],
      },
    });

    return res.json({ appointments });
  }
}

export default new ScheduleController();
